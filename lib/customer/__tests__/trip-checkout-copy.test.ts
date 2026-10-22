import {describe,expect,it} from 'vitest';
import {createInstance} from 'i18next';
import en from '@/app/i18n/locales/en/customer.json';
import ms from '@/app/i18n/locales/ms/customer.json';
import zh from '@/app/i18n/locales/zh-CN/customer.json';

describe('Trip candidate-review copy including plural overrides',()=>{
 it.each([['en',en,'Review planned purchases','Review'],['ms',ms,'Semak pembelian dirancang','Semak'],['zh-CN',zh,'检查计划购买','检查']] as const)('%s uses review wording for one and multiple candidates',async(locale,customer,label,short)=>{
  const i18n=createInstance();await i18n.init({lng:locale,fallbackLng:false,resources:{[locale]:{customer}},defaultNS:'customer'});
  for(const count of [1,2]){
   expect(i18n.t('ui.tripCheckout.button',{count})).toContain(label);
   expect(i18n.t('ui.tripCheckout.buy',{count})).toContain(short);
  }
 });
});
