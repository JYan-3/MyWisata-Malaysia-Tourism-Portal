import { test,expect } from '@playwright/test';
// Deterministic browser checks: intercept mail/commerce mutations; never create
// an order or send recovery mail against the linked development database.
test('guest order recovery is accessible without login and has a generic result',async({page})=>{
 await page.route('**/api/guest/cart',route=>route.fulfill({json:{data:{items:[]},error:null}}));
 await page.route('**/api/guest/orders/recover',route=>route.fulfill({json:{data:{message:'If the details match a guest order, an access link will be emailed.'},error:null}}));
 await page.goto('/customer/orders/access');
 await expect(page.getByRole('heading',{name:'Access your guest order'})).toBeVisible();
 await page.getByLabel('Order number').fill('1d4057cf-c821-4b05-a454-61dbdc42d32c');
 await page.getByLabel('Contact email').fill('guest@example.com');
 await page.getByRole('button',{name:'Email me an order link'}).click();
 await expect(page.getByRole('status')).toContainText('If the details match');
});
test('private order link is removed from the URL before exchange and cannot reveal a different order',async({page})=>{
 await page.route('**/api/guest/cart',route=>route.fulfill({json:{data:{items:[]},error:null}}));
 let exchanged=false;
 await page.route('**/api/guest/orders/access',async route=>{exchanged=true;expect(route.request().postDataJSON().token).toBe('A'.repeat(43));await route.fulfill({status:404,json:{data:null,error:null}});});
 await page.goto(`/customer/orders/access#token=${'A'.repeat(43)}`);
 await expect(page.getByRole('heading',{name:'Access your guest order'})).toBeVisible();
 expect(exchanged).toBe(true);expect(page.url()).not.toContain('#');expect(page.url()).not.toContain('token');
});
for (const booking of [false,true]) {
 test(`guest ${booking ? 'free booking' : 'product payment'} sends contact without registration or phone verification`,async({page})=>{
  const id='1d4057cf-c821-4b05-a454-61dbdc42d32c';
  const variant='2d4057cf-c821-4b05-a454-61dbdc42d32c';
  const slot='3d4057cf-c821-4b05-a454-61dbdc42d32c';
  await page.route('**/rest/v1/**',route=>{
   const resource=new URL(route.request().url()).pathname.split('/').pop();
   const data=resource==='products'?[{id,vendor_id:id,outlet_id:id,name:'Guest test item',base_price:booking?0:10,requires_booking:booking,status:'active',review_status:'approved',product_variants:[{id:variant,name:'Standard',price_offset:0,inventory:[{quantity:10,reserved:0}]}],price_rules:[]}]:resource==='booking_slots'?[{id:slot,product_id:id,starts_at:'2026-10-10T02:00:00Z',ends_at:'2026-10-10T03:00:00Z',capacity:10,booked:0,status:'available'}]:[];
   return route.fulfill({json:data});
  });
  await page.route('**/api/guest/cart',route=>route.fulfill({json:{data:{items:[{activityId:id,variantId:variant,outletId:id,slotId:booking?slot:undefined,qty:1}]},error:null}}));
  await page.route('**/api/guest/session',route=>route.fulfill({json:{data:{ready:true},error:null}}));
  let prepared=false;
  await page.route('**/api/checkout/prepare',route=>{
   const body=route.request().postDataJSON();
   expect(body.contact.email).toBe('guest+trip@example.com');expect(body.contact.phone).toBeNull();
   expect(body.paymentMethod).toBe(booking?'free_reservation':'stripe_card');prepared=true;
   return route.fulfill({json:{data:{order_id:id,checkout_session_id:id,...(booking?{}:{stripeUrl:'https://checkout.example/guest-fixture'})},error:null}});
  });
  await page.route('https://checkout.example/**',route=>route.fulfill({body:'Payment provider fixture'}));
  await page.route('**/api/customer/orders/*',route=>route.fulfill({status:404,json:{data:null,error:{message:'Fixture order'}}}));
  await page.goto('/customer/checkout');
  await expect(page.getByRole('heading',{name:'Guest test item'})).toBeVisible();
  await page.getByLabel('Contact email').fill('guest+trip@example.com');
  await page.getByRole('button',{name:booking?/reserve.*free|free.*spot/i:/continue.*stripe/i}).click();
  await expect(page).toHaveURL(booking?new RegExp(`/customer/orders/${id}`):/checkout.example\/guest-fixture/);
  expect(prepared).toBe(true);
 });
}
