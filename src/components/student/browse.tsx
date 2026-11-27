'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  MapPin,
  Utensils,
  Sandwich,
  CupSoda,
  Soup,
  IceCreamBowl,
  Grid2X2,
  Plus,
  SlidersHorizontal,
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
import { MealPlanning } from './meal-planning';
import { useWalletBalance } from './wallet-cash-in';
import type { MenuItem, Catalog } from '@/types';
const icons = [Utensils, Sandwich, CupSoda, Soup, IceCreamBowl];
export function FoodCard({
  item,
  catalog,
  variant = 'tile',
}: {
  item: MenuItem;
  catalog: Catalog;
  variant?: 'tile' | 'menu' | 'search';
}) {
  const stall = catalog.stalls.find((s) => s.id === item.stall_id);
  const available =
    item.is_available &&
    item.stock_quantity !== 0 &&
    stall?.is_open &&
    stall.reservation_mode !== 'paused';
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
    <article className={`food-card food-card-${variant} ${!available ? 'unavailable' : ''}`}>
      <div className="food-image">
        <Link href={`/student/food/${item.id}`} aria-label={item.name}>
          <img src={item.image_url} alt="" loading="lazy" draggable={false} />
        </Link>
        {!available && (
          <span className="sold-out">
            {!stall?.is_open
              ? 'Stall closed'
              : stall.reservation_mode === 'paused'
                ? 'Reservations paused'
                : item.stock_quantity === 0
                  ? 'Sold out for reservations'
                  : 'Unavailable'}
          </span>
        )}
      </div>
      <div className="food-card-copy">
        {variant === 'search' && (
          <Link className="result-stall" href={`/student/stall/${item.stall_id}`}>
            {stall?.name} <ChevronRight size={15} />
          </Link>
        )}
        <Link href={`/student/food/${item.id}`}>
          <h3>{item.name}</h3>
        </Link>
        <div className="food-meta">
          <strong>{money(item.price_centavos)}</strong>
        </div>
      </div>
      {available && (
        <button aria-label={`Add ${item.name} to cart`} onClick={add} className="add-food">
          <Plus size={18} />
        </button>
      )}
    </article>
  );
}
export function Browse({ location, search = false }: { location?: string; search?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { name, user, role } = useSession();
  const wallet = useWalletBalance(
    !location && !search && role === 'student' ? user?.id : undefined,
  );
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
        <section className="welcome-row">
          <div>
            <h1>
              Hello, {name}! <span aria-hidden="true">👋</span>
            </h1>
            <p>Central Philippine University</p>
          </div>
          {wallet.data !== undefined && (
            <Link className="secondary-button" href="/student/wallet">
              Wallet · {money(wallet.data)}
            </Link>
          )}
        </section>
      ) : !search ? (
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
          <h1>{selected?.name || 'All campus locations'}</h1>
        </section>
      ) : null}
      <div className="browse-toolbar">
        <SearchField
          placeholder="Search for food or stall…"
          value={query}
          onClear={() => {
            setQuery('');
            setDebounced('');
            setOffset(0);
            if (search) router.replace('/student/search');
          }}
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
          aria-label="Filters"
          aria-expanded={filters}
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
      {!searching && (
        <div className="category-row" aria-label="Food categories">
          {data.categories.map((cat, i) => {
            const Icon = icons[i % icons.length];
            return (
              <button
                key={cat.id}
                className={`category ${category === cat.id ? 'selected' : ''}`}
                aria-pressed={category === cat.id}
                onClick={() => {
                  setCategory(category === cat.id ? 'all' : cat.id);
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
          <button
            className={`category ${category === 'all' ? 'selected' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => {
              setCategory('all');
              setOffset(0);
            }}
          >
            <span>
              <Grid2X2 size={22} />
            </span>
            All
          </button>
        </div>
      )}
      {!searching && !selected && category === 'all' && !maxPrice && (
        <section id="locations" className="locations-section">
          <div className="section-heading">
            <h2>Browse by Location</h2>
            {!location && (
              <Link href="/student/location/all">
                See All <ChevronRight size={17} />
              </Link>
            )}
          </div>
          <div className="location-grid">
            {data.locations.map((loc) => (
              <Link className="location-card" href={`/student/location/${loc.id}`} key={loc.id}>
                <img src={loc.image_url} alt="" loading="lazy" draggable={false} />
                <h3>{loc.name}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}
      {searching || category !== 'all' || maxPrice ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>{debounced ? `Search Results for “${query}”` : 'Explore the menu'}</h2>
              <p className="result-count" role="status">
                {searchBusy
                  ? 'Searching…'
                  : `${items.length} ${items.length === 1 ? 'item' : 'items'} found`}
              </p>
            </div>
          </div>
          {searchError ? (
            <ErrorBox error={searchError} />
          ) : items.length ? (
            <div className="search-results">
              {items.map((item) => (
                <FoodCard key={item.id} item={item} catalog={data} variant="search" />
              ))}
            </div>
          ) : (
            <Empty
              title="No bites found"
              text="Try another food, stall, or location, or adjust your filters."
            />
          )}
          {configured && online && (offset > 0 || (found?.length ?? 0) >= 50) && (
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
            <h2>{selected ? `Fresh finds in ${selected.name}` : 'Featured Stalls'}</h2>
            {!location && (
              <Link href="/student/location/all">
                See All <ChevronRight size={17} />
              </Link>
            )}
          </div>
          {!location && (
            <div className="featured-scroll">
              {stalls.map((stall) => (
                <Link key={stall.id} href={`/student/stall/${stall.id}`} className="featured-stall">
                  <img
                    src={
                      data.items.find((item) => item.stall_id === stall.id)?.image_url ||
                      stall.image_url
                    }
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                  <strong>{stall.name}</strong>
                </Link>
              ))}
            </div>
          )}
          {location &&
            stalls.map((stall) => (
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
      {!location && !filtered && !search && <MealPlanning catalog={data} />}
    </motion.div>
  );
}
