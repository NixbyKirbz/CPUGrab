'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Heart, ArrowRight } from 'lucide-react';
import { fetchCatalog } from '@/services/catalog';
import { useSession } from '@/components/providers';
import { PageTitle, Empty, Loading, ErrorBox } from '@/components/ui';
import { useFavorites, FavoriteButton } from './menu';
import { FoodCard } from './browse';
export function Favorites() {
  const { user } = useSession();
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const { data: favorites = [], isPending, error } = useFavorites();
  if (!user)
    return (
      <>
        <PageTitle title="Your favorites" />
        <Empty
          title="Good food is worth remembering"
          text="Sign in to keep your favorite campus stalls and meals close."
        >
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        </Empty>
      </>
    );
  if (isPending || !catalog) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageTitle title="Your favorites" subtitle="The familiar favorites. The new obsessions." />
      {favorites.length ? (
        <>
          <div className="order-grid">
            {catalog.stalls
              .filter((s) => favorites.some((f) => f.stall_id === s.id))
              .map((s) => (
                <div
                  className="panel"
                  key={s.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 15 }}
                >
                  <Link href={`/student/stall/${s.id}`} style={{ flex: 1 }}>
                    <h3>{s.name}</h3>
                    <p className="help-text" style={{ marginTop: 8 }}>
                      {catalog.locations.find((l) => l.id === s.location_id)?.name}
                    </p>
                  </Link>
                  <FavoriteButton id={s.id} />
                </div>
              ))}
          </div>
          <div className="menu-grid">
            {catalog.items
              .filter((i) => favorites.some((f) => f.menu_item_id === i.id))
              .map((i) => (
                <div key={i.id}>
                  <FoodCard item={i} catalog={catalog} />
                  <FavoriteButton id={i.id} kind="menu_item_id" />
                </div>
              ))}
          </div>
        </>
      ) : (
        <Empty
          title="Find something you love"
          text="Tap the heart on a stall or food item to save it here."
        >
          <Link className="primary-button" href="/student/home">
            <Heart size={17} />
            Explore campus food <ArrowRight size={16} />
          </Link>
        </Empty>
      )}
    </>
  );
}
