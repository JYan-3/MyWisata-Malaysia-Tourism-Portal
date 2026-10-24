import { describe, expect, it } from 'vitest';
import { reviewQueueQuery } from '../review-queue';
const request=(query: string)=>new Request(`http://localhost/api/admin/queue?${query}`);
describe('bounded reviewer queue filters',()=>{
  it('preserves literal multilingual search and allowed page sizes',()=>{
    const result=reviewQueueQuery(request('search='+encodeURIComponent('美食 100% (A12)')+'&page=2&pageSize=25&status=paused'),'promotions');
    expect(result.success).toBe(true);
    if(result.success) expect(result.data).toEqual({page:2,pageSize:25,status:'paused',search:'美食 100% (A12)'});
  });
  it.each(['page=0','page=100001','pageSize=99999','status=unknown','search='+ 'x'.repeat(201)])('rejects unbounded or invalid input: %s',query=>{
    expect(reviewQueueQuery(request(query),'registrations').success).toBe(false);
  });
  it('retains the existing refund default and options',()=>{
    expect(reviewQueueQuery(request(''),'refunds').data?.pageSize).toBe(15);
    expect(reviewQueueQuery(request('pageSize=50'),'refunds').success).toBe(true);
    expect(reviewQueueQuery(request('pageSize=10'),'refunds').success).toBe(false);
  });
});
