import { authorizeOrder } from '@/lib/checkout/order-access';
import { guestPrivateResponse } from '@/lib/checkout/guest-session';
import { ORDER_SELECT, BOOKING_SELECT, mapOrder, mapBooking } from '@/backend/domains/commerce';
export async function GET(request: Request,{params}:{params:Promise<{orderId:string}>}) {
  const {orderId}=await params;
  const access=await authorizeOrder(request,orderId);
  if (!access) return guestPrivateResponse(null,404);
  const [{data:order,error},{data:bookings,error:bookingError}]=await Promise.all([
    access.db.from('orders').select(ORDER_SELECT).eq('id',orderId).single(),
    access.db.from('bookings').select(BOOKING_SELECT).eq('order_items.order_id',orderId),
  ]);
  if (error || bookingError || !order) return guestPrivateResponse(null,503);
  return guestPrivateResponse({order:mapOrder(order as unknown as Parameters<typeof mapOrder>[0]),bookings:(bookings??[]).map(row=>mapBooking(row as unknown as Parameters<typeof mapBooking>[0])).filter(Boolean)});
}
