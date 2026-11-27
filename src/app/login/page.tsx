import { Auth } from '@/components/auth';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  return <Auth mode="login" seller={(await searchParams).role === 'seller'} />;
}
