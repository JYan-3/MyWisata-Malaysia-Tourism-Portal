import React, { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestDom, TestEvent, type TestDocument, type TestElement } from '@/components/shared/__tests__/render-test-dom';
import { useVisibleReviewRefresh } from '../use-visible-review-refresh';
let document: TestDocument;
let createRoot: typeof import('react-dom/client').createRoot;
let root: ReturnType<typeof createRoot>;
let container: TestElement;
function Probe({ run }: { run: (signal: AbortSignal) => Promise<void> }) { useVisibleReviewRefresh({ enabled: true, onRefresh: run }); return null; }
beforeAll(async () => { document=installTestDom(); ({ createRoot }=await import('react-dom/client')); });
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document,'visibilityState',{ configurable:true, writable:true, value:'visible' });
  container=document.createElement('div'); document.body.appendChild(container);
  root=createRoot(container as unknown as Element);
});
afterEach(async () => { await act(async()=>root.unmount()); document.body.removeChild(container); vi.useRealTimers(); });
async function advance(ms: number) { await act(async()=>{ await vi.advanceTimersByTimeAsync(ms); }); }
describe('visible reviewer refresh behavior',()=>{
  it('does no hidden-page reads and refreshes on return, then cleans up',async()=>{
    const run=vi.fn(async()=>{});
    Object.defineProperty(document,'visibilityState',{value:'hidden',writable:true,configurable:true});
    await act(async()=>root.render(React.createElement(Probe,{run})));
    await advance(90_000); expect(run).not.toHaveBeenCalled();
    Object.defineProperty(document,'visibilityState',{value:'visible',writable:true,configurable:true});
    await act(async()=>{ document.dispatchEvent(new TestEvent('visibilitychange')); });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async()=>root.unmount());
    await advance(90_000); expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not overlap slow reads, aborts at the deadline, and backs off',async()=>{
    let finish!:()=>void;
    const run=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{ finish=resolve; })).mockResolvedValue(undefined);
    await act(async()=>root.render(React.createElement(Probe,{run})));
    await advance(30_000); expect(run).toHaveBeenCalledTimes(1);
    const signal=run.mock.calls[0][0] as AbortSignal;
    await advance(30_000); expect(signal.aborted).toBe(true); expect(run).toHaveBeenCalledTimes(1);
    await act(async()=>finish());
    await advance(59_999); expect(run).toHaveBeenCalledTimes(1);
    await advance(1); expect(run).toHaveBeenCalledTimes(2);
  });
  it('stops automatic reads after access is revoked',async()=>{
    const run=vi.fn().mockRejectedValue(Object.assign(new Error('revoked'),{status:403}));
    await act(async()=>root.render(React.createElement(Probe,{run})));
    await advance(30_000); expect(run).toHaveBeenCalledTimes(1);
    await advance(240_000);
    await act(async()=>{ document.dispatchEvent(new TestEvent('visibilitychange')); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
