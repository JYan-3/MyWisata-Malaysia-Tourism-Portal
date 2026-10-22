import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {createTestCustomer,installTripFixtureCleanup,rest,signInTestCustomer} from './helpers/trip-fixture';

test.setTimeout(180_000);
test.describe.configure({retries:0});
test.use({actionTimeout:30_000});
installTripFixtureCleanup();

test('explicit outlet and specification choices retain quantity and price through checkout',async({page,request})=>{
  // Read the existing public multi-outlet sample; write only this run's own cart/account.
  const productId='a79e8798-b72b-8b92-4a24-334323018047';
  const [product]=await rest<Array<{name:string;product_variants:Array<{id:string;label:string;is_active:boolean}>}>>(request,'GET',`products?select=name,product_variants(id,label:name,is_active)&id=eq.${productId}`);
  const offers=await rest<Array<{outlet_id:string;outlets:{name:string}}>>(request,'GET',`outlet_offers?select=outlet_id,outlets(name)&product_id=eq.${productId}&status=eq.active&order=price`);
  expect(offers.length).toBeGreaterThan(1);
  const variants=product.product_variants.filter(variant=>variant.is_active);
  expect(variants.length).toBeGreaterThan(1);
  const variant=variants[1];
  const stock=await rest<Array<{outlet_id:string;quantity:number;reserved:number}>>(request,'GET',`inventory?select=outlet_id,quantity,reserved&variant_id=eq.${variant.id}`);
  const chosen=offers.find(offer=>stock.some(row=>row.outlet_id===offer.outlet_id && row.quantity-row.reserved>=3));
  expect(chosen,'a non-default specification with three available units').toBeTruthy();
  const initial=offers.find(offer=>offer.outlet_id!==chosen!.outlet_id)!;
  const customer=await createTestCustomer(randomUUID(),request);
  await signInTestCustomer(page,customer);
  await page.route('**/api/interactions',route=>route.fulfill({json:{data:{accepted:true}}}));
  await page.request.post('/api/locale',{data:{locale:'en'}});
  await page.goto(`/customer/activity/${productId}?outletId=${initial.outlet_id}`);
  const shortOutlet=chosen!.outlets.name.split('—').at(-1)!.trim();
  const outletButton=page.getByRole('button').filter({hasText:shortOutlet});
  await outletButton.click();
  await page.waitForURL(url=>url.searchParams.get('outletId')===chosen!.outlet_id);
  await expect(outletButton).toHaveAttribute('aria-pressed','true');
  const variantButton=page.getByRole('button').filter({hasText:variant.label});
  await variantButton.click();
  await expect(variantButton).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Increase quantity',exact:true}).click();
  await page.getByRole('button',{name:'Add to Cart',exact:true}).click();
  await page.getByRole('link',{name:'View cart',exact:true}).click();
  await page.waitForURL('**/customer/cart');
  const selected=page.getByRole('checkbox',{name:`Select ${product.name}`,exact:true});
  await selected.check();
  const rows=()=>rest<Array<{variant_id:string;outlet_id:string;quantity:number}>>(request,'GET',`cart_items?select=variant_id,outlet_id,quantity,carts!inner(user_id)&carts.user_id=eq.${customer.id}`);
  await expect.poll(rows,{timeout:30_000}).toMatchObject([{variant_id:variant.id,outlet_id:chosen!.outlet_id,quantity:2}]);
  await page.getByRole('button',{name:'+',exact:true}).click();
  await expect.poll(rows,{timeout:30_000}).toMatchObject([{variant_id:variant.id,outlet_id:chosen!.outlet_id,quantity:3}]);
  const line=page.locator('div.rounded-xl.border').filter({has:selected});
  await expect(line).toHaveCount(1);
  // The database commits before the cart refresh response reconciles the rendered quantity.
  await expect(line.locator('span.w-6.text-center')).toHaveText('3',{timeout:30_000});
  const cartTotal=await line.locator('span.font-bold.text-foreground').innerText();
  await page.getByRole('link',{name:'Proceed to checkout (1)',exact:true}).click();
  await page.waitForURL('**/customer/checkout');
  const heading=page.getByRole('heading',{name:product.name,exact:true});
  await expect(heading).toBeVisible();
  await expect(heading.locator('..').locator('span.text-sm.font-bold')).toHaveText(cartTotal);
  await expect(page.getByText('Qty: 3',{exact:true})).toBeVisible();
  await expect(page.getByText(new RegExp(shortOutlet))).toBeVisible();
  await page.screenshot({path:test.info().outputPath('explicit-choices-checkout.png'),fullPage:true});
});
