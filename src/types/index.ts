export type Role = 'student' | 'seller' | 'admin';
export type Location = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  is_active: boolean;
  display_order: number;
  is_delivery_dropoff?: boolean;
};
export type Category = { id: string; name: string; icon: string; display_order: number };
export type Stall = {
  id: string;
  owner_id: string | null;
  location_id: string;
  name: string;
  description: string;
  image_url: string;
  cover_image_url: string;
  contact_number: string;
  opening_hours: string;
  is_open: boolean;
  reservation_mode?: 'normal' | 'busy' | 'paused';
  busy_order_limit?: number;
  reservation_opens_at?: string;
  reservation_closes_at?: string;
  delivery_enabled?: boolean;
  delivery_closes_at?: string;
  is_demo?: boolean;
  updated_at?: string;
  approval_status: 'pending' | 'approved' | 'suspended';
};
export type MenuItem = {
  id: string;
  stall_id: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string;
  price_centavos: number;
  is_available: boolean;
  is_archived: boolean;
  stock_quantity: number | null;
  preparation_minutes?: number;
};
export type Pricing = {
  id: number;
  reservation_fee_centavos: number;
  stall_fee_share_centavos: number;
  platform_fee_share_centavos: number;
  default_markup_centavos: number;
  delivery_fee_centavos?: number;
  group_delivery_fee_centavos?: number;
  group_delivery_max_orders?: number;
};
export type Catalog = {
  locations: Location[];
  stalls: Stall[];
  items: MenuItem[];
  categories: Category[];
  settings: Pricing;
};
export type OrderStatus = 'reserved' | 'ready' | 'completed' | 'cancelled';
export type PaymentMethod = 'gcash' | 'wallet';
export type DeliveryPhase =
  | 'pending'
  | 'assigned'
  | 'collected'
  | 'on_the_way'
  | 'arrived'
  | 'completed'
  | 'cancelled'
  | 'handover_issue'
  | 'unsuccessful';
export type DeliveryWorker = {
  user_id: string;
  full_name: string;
  student_number: string;
  contact: string;
  demo_verification: string;
  review_status: 'pending' | 'approved' | 'declined' | 'suspended';
  available_from: string | null;
  available_until: string | null;
  next_class_at: string | null;
  preferred_areas: string[];
};
export type Delivery = {
  order_id: string;
  worker_id: string | null;
  group_id: string | null;
  stall_id: string;
  dropoff_id: string;
  phase: DeliveryPhase;
  offer_expires_at: string;
  pickup_start: string;
  pickup_end: string;
  delivery_until: string;
  wait_until: string | null;
  customer_ready_at: string | null;
  completed_at: string | null;
  delay_requested_minutes: number | null;
  delay_decision: 'pending' | 'accepted' | 'declined' | null;
  recipient_name: string | null;
  compensation_centavos: number;
  settled_at: string | null;
  worker_earnings_centavos: number;
  issue_note: string | null;
};
export type OrderItem = {
  menu_item_id: string;
  item_name_snapshot: string;
  quantity: number;
  unit_price_centavos: number;
  subtotal_centavos: number;
};
export type Order = {
  id: string;
  order_number: string;
  stall_id: string;
  student_id: string;
  pickup_slot_id: string;
  status: OrderStatus;
  payment_method: PaymentMethod | 'cash';
  payment_status: 'unpaid' | 'paid' | 'refunded';
  payment_reference: string | null;
  refund_reference: string | null;
  reward_discount_centavos: number;
  subtotal_centavos: number;
  reservation_fee_centavos: number;
  delivery_fee_centavos: number;
  markup_centavos: number;
  total_centavos: number;
  cancellation_reason: string | null;
  customer_notes: string;
  created_at: string;
  completed_at: string | null;
  order_items: OrderItem[];
  pickup_slots: { start_time: string; end_time: string };
  delivery: Delivery | null;
};
export type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  max_reservations: number;
  remaining: number;
  portions_left?: number;
  availability?: 'available' | 'limited' | 'full' | 'unavailable';
};
