import { SellerAccess } from '@/components/seller/context';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SellerAccess>{children}</SellerAccess>;
}
