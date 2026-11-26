import { ItemForm } from '@/components/seller/item-form';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ItemForm id={(await params).id} />;
}
