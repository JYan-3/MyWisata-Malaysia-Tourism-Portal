"use client";

import {useEffect,useState} from "react";
import {ORS_PROFILE,type RouteResult} from "@/lib/routing";
import type {TravelModeId} from "@/lib/travel-modes";

type Entry = {key:string; routes:RouteResult[]; failed:boolean};

/** Keep at most the supported modes for the current coordinates/departure. */
export function useTripRoutes(points:[number,number][],mode:TravelModeId,departureTime:string | undefined,refreshTick:number) {
  const [entries,setEntries]=useState<Partial<Record<TravelModeId,Entry>>>({});
  const baseKey=JSON.stringify([points,departureTime ?? "live"]);
  const requestKey=`${baseKey}|${mode === "DRIVING" ? refreshTick : 0}`;
  const supported=points.length>=2 && Boolean(ORS_PROFILE[mode]);
  const cached=entries[mode];
  const current=cached?.key === requestKey ? cached : undefined;
  useEffect(()=>{
    if (!supported || current) return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const [coordinates,departure]=JSON.parse(baseKey) as [[number,number][],string];
        const response=await fetch("/api/route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,points:coordinates,departureTime:departure === "live" ? undefined : departure}),signal:controller.signal});
        const body=await response.json() as {data?:{routes?:RouteResult[]}};
        if (controller.signal.aborted) return;
        const routes=response.ok ? body.data?.routes ?? [] : [];
        setEntries(previous=>({...Object.fromEntries(Object.entries(previous).filter(([,entry])=>entry.key.startsWith(`${baseKey}|`))),[mode]:{key:requestKey,routes,failed:!routes.length}}));
      } catch {
        if (!controller.signal.aborted) setEntries(previous=>({...previous,[mode]:{key:requestKey,routes:[],failed:true}}));
      }
    },400);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[baseKey,current,mode,requestKey,supported]);
  const stale=supported && !current && Boolean(cached?.key.startsWith(`${baseKey}|`) && cached.routes.length);
  return {routes:supported ? current?.routes ?? (stale ? cached!.routes : []) : [],loading:supported && !current,status:!supported ? "unsupported" : current ? current.failed ? "unavailable" : "ready" : stale ? "stale" : "loading"} as const;
}
