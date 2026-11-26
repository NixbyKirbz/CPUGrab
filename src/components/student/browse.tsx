'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Utensils,
  Sandwich,
  CupSoda,
  Soup,
  IceCreamBowl,
  Grid2X2,
  Clock3,
  Plus,
  SlidersHorizontal,
  ShoppingBag,
  CalendarCheck,
  QrCode,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { fetchCatalog } from '@/services/catalog';
import { configured, getSupabase } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import { useSession } from '@/components/providers';
import { SearchField } from '@/components/shell';
import { Loading, ErrorBox, Empty } from '@/components/ui';
import { useCart } from '@/stores/cart';
import type { MenuItem, Catalog } from '@/types';
const icons = [Utensils, Sandwich, CupSoda, Soup, IceCreamBowl];
export function FoodCard({ item, catalog }: { item: MenuItem; catalog: Catalog }) {
  const stall = catalog.stalls.find((s) => s.id === item.stall_id);
  const { toast } = useSession();
  const add = () => {
    if (!useCart.getState().add(item)) {
      if (window.confirm('Your cart contains food from another stall. Replace it with this item?'))
        useCart.getState().add(item, 1, true);
      else return;
    }
    toast(`${item.name} added to your cart`);
  };
  return (
    <article className={`food-card ${!item.is_available ? 'unavailable' : ''}`}>
      <div className="food-image">
        <Link href={`/student/food/${item.id}`}>
          <img src={item.image_url} alt={item.name} loading="lazy" />
        </Link>
        {item.is_available && stall?.is_open ? (
          <button aria-label={`Add ${item.name} to cart`} onClick={add} className="add-food">
            <Plus size={19} />
          </button>
        ) : (
          <span className="sold-out">{stall?.is_open ? 'Unavailable' : 'Stall closed'}</span>
        )}
      </div>
      <Link href={`/student/food/${item.id}`}>
        <h3>{item.name}</h3>
      </Link>
      <div className="food-meta">
        <strong>{money(item.price_centavos)}</strong>
        <span>per serving</span>
      </div>
    </article>
  );
}
export function Browse({ location, search = false }: { location?: string; search?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { name } = useSession();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['catalog'],
    queryFn: fetchCatalog,
  });
  const [query, setQuery] = useState(params.get('q') || '');
  const [debounced, setDebounced] = useState(query);
  const [category, setCategory] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filters, setFilters] = useState(false);
  const [offset, setOffset] = useState(0);
  const [online, setOnline] = useState(true);
  const searching = search || Boolean(debounced);
  const filtered = searching || category !== 'all' || Boolean(maxPrice);
  const {
    data: found,
    error: searchError,
    isFetching: searchBusy,
  } = useQuery({
    queryKey: ['menu-search', debounced, category, filterLocation, location, maxPrice, offset],
    enabled: configured && online && filtered,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('search_menu', {
        p_query: debounced,
        p_category: category === 'all' ? null : category,
        p_location:
          filterLocation !== 'all'
            ? filterLocation
            : location && location !== 'all'
              ? location
              : null,
        p_max_price: maxPrice ? Math.round(Number(maxPrice) * 100) : null,
        p_offset: offset,
      });
      if (error) throw error;
      return data as MenuItem[];
    },
  });
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const timer = setTimeout(update, 0);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim().toLowerCase()), 250);
    return () => clearTimeout(id);
  }, [query]);
  if (isPending) return <Loading />;
  if (error || !data) return <ErrorBox error={error} retry={() => void refetch()} />;
  const selected = data.locations.find((l) => l.id === location);
  const stalls = data.stalls.filter(
    (s) =>
      (!selected || s.location_id === selected.id) &&
      (filterLocation === 'all' || s.location_id === filterLocation),
  );
  const items = (configured && online && filtered && found ? found : data.items).filter((i) => {
    const stall = stalls.find((s) => s.id === i.stall_id);
    const cat = data.categories.find((c) => c.id === i.category_id);
    const loc = data.locations.find((l) => l.id === stall?.location_id);
    return (
      stall &&
      (category === 'all' || i.category_id === category) &&
      (!maxPrice || i.price_centavos <= Number(maxPrice) * 100) &&
      (!debounced ||
        `${i.name} ${stall.name} ${cat?.name} ${loc?.name}`.toLowerCase().includes(debounced))
    );
  });
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {!location && !search ? (
        <>
          <section className="welcome-row">
            <div>
              <p className="eyebrow">A GOOD DAY STARTS WITH GOOD FOOD</p>
              <h1>
                Hey, {name}! <span className="wave">☀</span>
              </h1>
              <p>A full schedule? Let’s make room for a good meal.</p>
            </div>
            <div className="pickup-badge">
              <span>
                <MapPin size={17} />
              </span>
              Campus pickup only
            </div>
          </section>
          <section className="hero">
            <div className="hero-copy">
              <div className="hero-kicker">
                <span /> LESS WAITING. MORE LIVING.
              </div>
              <h2>
                Your next meal,
                <br />
                without the <span>wait.</span>
              </h2>
              <p>
                Find your campus favorites. Reserve ahead.
                <br className="desktop-break" /> Pick up when it works for you.
              </p>
              <Link href="#locations" className="gold-button">
                Find your next bite <ArrowRight size={18} />
              </Link>
              <div className="hero-footnote">
                <Clock3 size={14} /> A better break is just a few taps away.
              </div>
            </div>
            <div className="hero-art">
              <img src="/images/chicken.jpg" alt="A freshly prepared meal" fetchPriority="high" />
              <div className="hero-food-label">
                <span className="food-label-icon">
                  <ShoppingBag size={21} />
                </span>
                <div>
                  <strong>A little break. A great meal.</strong>
                  <small>Reserved by you. Ready for you.</small>
                </div>
                <span className="label-check">✓</span>
              </div>
              <div className="hero-sticker">
                SKIP
                <br />
                THE LINE <ArrowUpRight size={20} />
              </div>
            </div>
            <div className="hero-number">
              01 / 03 <span />
            </div>
          </section>
        </>
      ) : (
        <section
          className={`location-heading ${selected ? 'has-cover' : ''}`}
          style={
            selected
              ? {
                  backgroundImage: `linear-gradient(90deg,rgba(5,26,53,.91),rgba(5,26,53,.25)),url(${selected.image_url})`,
                }
              : undefined
          }
        >
          <Link href="/student/home" className="back-link">
            ← Back to home
          </Link>
          <p className="eyebrow">{search ? 'FIND YOUR FAVORITES' : 'EXPLORE YOUR CAMPUS'}</p>
          <h1>{search ? 'What are you craving?' : selected?.name || 'All campus locations'}</h1>
          <p>
            {search
              ? 'Good food is closer than you think.'
              : 'Browse every stall. Find something you’ll love.'}
          </p>
        </section>
      )}
      <div className="browse-toolbar">
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          onSubmit={() => {
            if (!search) router.push(`/student/search?q=${encodeURIComponent(query)}`);
          }}
        />
        <button
          className={`filter-button ${filters ? 'selected' : ''}`}
          onClick={() => setFilters(!filters)}
        >
          <SlidersHorizontal size={18} />
          <span>Filters</span>
        </button>
      </div>
      {filters && (
        <div className="filter-panel">
          <label>
            Maximum price (₱)
            <input
              type="number"
              min="0"
              placeholder="Any price"
              value={maxPrice}
              onChange={(e) => {
                setMaxPrice(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Location
            <select
              value={filterLocation}
              onChange={(e) => {
                setFilterLocation(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">All locations</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="text-button"
            onClick={() => {
              setMaxPrice('');
              setFilterLocation('all');
              setCategory('all');
              setOffset(0);
            }}
          >
            Reset filters
          </button>
        </div>
      )}
      <div className="category-row">
        <button
          className={`category ${category === 'all' ? 'selected' : ''}`}
          onClick={() => {
            setCategory('all');
            setOffset(0);
          }}
        >
          <span>
            <Grid2X2 size={23} />
          </span>
          All food
        </button>
        {data.categories.map((cat, i) => {
          const Icon = icons[i % icons.length];
          return (
            <button
              key={cat.id}
              className={`category ${category === cat.id ? 'selected' : ''}`}
              onClick={() => {
                setCategory(cat.id);
                setOffset(0);
              }}
            >
              <span>
                <Icon size={24} />
              </span>
              {cat.name}
            </button>
          );
        })}
        <div className="category-note">
          <span className="tiny-gold-line" />A craving for every
          <br />
          kind of campus day.
        </div>
      </div>
      {!searching && category === 'all' && (
        <section id="locations" className="locations-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GOOD FOOD, AROUND THE CORNER</p>
              <h2>Where are you headed?</h2>
            </div>
            <Link href="/student/location/all">
              All locations <ArrowRight size={16} />
            </Link>
          </div>
          <div className="location-grid">
            {data.locations.map((loc, i) => (
              <Link
                className={`location-card ${selected?.id === loc.id ? 'selected' : ''}`}
                href={`/student/location/${loc.id}`}
                key={loc.id}
              >
                <img
                  src={loc.image_url}
                  alt={`Illustrative setting for ${loc.name}`}
                  loading="lazy"
                />
                <div className="location-card-overlay" />
                <span className="location-number">0{i + 1}</span>
                <div>
                  <span className="location-tag">
                    <MapPin size={12} />
                    {data.stalls.filter((s) => s.location_id === loc.id).length}{' '}
                    {data.stalls.filter((s) => s.location_id === loc.id).length === 1
                      ? 'stall'
                      : 'stalls'}{' '}
                    to explore
                  </span>
                  <h3>
                    {loc.name}
                    <ArrowUpRight size={23} />
                  </h3>
                  <p>{loc.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {searching || category !== 'all' || maxPrice ? (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR NEXT BITE</p>
              <h2>{debounced ? `Results for “${query}”` : 'Explore the menu'}</h2>
            </div>
            <span className="muted">
              {searchBusy ? 'Searching…' : `${items.length} items found`}
            </span>
          </div>
          {searchError ? (
            <ErrorBox error={searchError} />
          ) : items.length ? (
            <div className="search-results">
              {items.map((item) => {
                const stall = data.stalls.find((s) => s.id === item.stall_id);
                return (
                  <div key={item.id}>
                    <FoodCard item={item} catalog={data} />
                    <Link className="result-stall" href={`/student/stall/${item.stall_id}`}>
                      {stall?.name} <ChevronRight size={13} />
                      <small>{data.locations.find((l) => l.id === stall?.location_id)?.name}</small>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No bites found"
              text="Try another food, stall, or location, or adjust your filters."
            />
          )}
          {configured && online && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 15, marginTop: 25 }}>
              <button
                className="secondary-button"
                disabled={offset === 0 || searchBusy}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <span className="help-text" style={{ alignSelf: 'center' }}>
                Page {Math.floor(offset / 50) + 1}
              </span>
              <button
                className="secondary-button"
                disabled={!found || found.length < 50 || searchBusy}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="stalls-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SMALL STALLS. BIG FAVORITES.</p>
              <h2>{selected ? `Fresh finds in ${selected.name}` : 'Your campus, served fresh'}</h2>
            </div>
            <span className="section-note">
              Find your new go-to <span>↘</span>
            </span>
          </div>
          {stalls.map((stall) => (
            <div className="stall-section" key={stall.id}>
              <div className="stall-heading">
                <Link className="stall-identity" href={`/student/stall/${stall.id}`}>
                  <img src={stall.image_url} alt="" loading="lazy" />
                  <div>
                    <h3>
                      {stall.name}
                      <span className={`status-dot ${stall.is_open ? 'open' : ''}`}>
                        {stall.is_open ? 'Open' : 'Closed'}
                      </span>
                    </h3>
                    <p>
                      <MapPin size={13} />
                      {data.locations.find((l) => l.id === stall.location_id)?.name}
                      <span className="stall-separator">·</span>
                      <span className="stall-description">{stall.description}</span>
                    </p>
                  </div>
                </Link>
                <Link className="view-menu" href={`/student/stall/${stall.id}`}>
                  View menu <ArrowRight size={16} />
                </Link>
              </div>
              <div className="food-scroll">
                {data.items
                  .filter((i) => i.stall_id === stall.id)
                  .map((item) => (
                    <FoodCard key={item.id} item={item} catalog={data} />
                  ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {!location && !search && (
        <section className="how-it-works">
          <div>
            <p className="eyebrow">YOUR BREAK, SIMPLIFIED</p>
            <h2>
              More lunch.
              <br />
              Less line.
            </h2>
          </div>
          {[
            {
              icon: Utensils,
              n: '01',
              title: 'Find your favorite',
              text: 'Explore food from campus stalls.',
            },
            {
              icon: CalendarCheck,
              n: '02',
              title: 'Make it a date',
              text: 'Reserve a meal and pick your time.',
            },
            {
              icon: QrCode,
              n: '03',
              title: 'Scan. Pick up. Enjoy.',
              text: 'Show your QR and get on with your day.',
            },
          ].map(({ icon: Icon, n, title, text }) => (
            <div className="how-step" key={n}>
              <span className="step-icon">
                <Icon size={23} />
              </span>
              <small>{n}</small>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>
      )}
      <div className="seller-invite">
        <span>
          <ShoppingBag size={18} />
          Have a food stall on campus?
        </span>
        <Link href="/register?role=seller">
          Grow with CPUGrab <ArrowUpRight size={16} />
        </Link>
      </div>
    </motion.div>
  );
}
