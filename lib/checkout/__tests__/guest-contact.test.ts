import {describe,it,expect} from 'vitest';
import {checkoutContactSchema} from '../contact';
describe('guest contact is not identity',()=>{
 it('accepts any valid email without Gmail canonicalization',()=>{expect(checkoutContactSchema.parse({email:'  a.b+trip@outlook.com  '})).toEqual({email:'a.b+trip@outlook.com'});});
 it('rejects invalid emails, owner fields and OTP/verification claims',()=>{for(const input of [{email:'gmail'},{email:'a@example.com',userId:'user'},{email:'a@example.com',emailVerified:true}])expect(checkoutContactSchema.safeParse(input).success).toBe(false);});
 it('validates contact phone without requiring an OTP',()=>{expect(checkoutContactSchema.parse({email:'a@example.com',phone:'+60123456789'}).phone).toBe('+60123456789');expect(checkoutContactSchema.safeParse({email:'a@example.com',phone:'123'}).success).toBe(false);});
});
