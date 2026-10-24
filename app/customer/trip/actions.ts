"use server";

import { createClient } from "@/lib/supabase/server";
import { createTrip, deleteTrip, getTripById, getTripItems, getTripNameSequence } from "@/backend/domains/trips";
import type { AddTripItemInput } from "@/backend/domains/trips";
import { searchTripActivities } from "@/backend/domains/catalogue";
import { getCachedDiscoveryActivityData } from "@/lib/cache/catalogue-cache";
import { getTripDiscoveryAnchor } from "@/lib/customer/trip-planner";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { nextDefaultTripName, parseSubmittedTripDates, parseSubmittedTripName } from "@/lib/customer/trip-name";

const tripDiscoverySchema = z.object({
  tripId: z.string().min(1).max(128),
  near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional(),
});

export async function searchTripActivitiesAction(tripId: string, near?: { lat: number; lng: number }) {
  const input = tripDiscoverySchema.parse({ tripId, near });
  const db = await createClient();
  const trip = await getTripById(input.tripId, db);
  if (!trip) throw new Error("Trip not found");
  const items = await getTripItems(input.tripId, db);
  const discoveryData = await getCachedDiscoveryActivityData();
  const anchor = input.near ?? getTripDiscoveryAnchor(items, trip.start_date);
  // Raw inventory stays on the server; only this owner's persisted stops can
  // request purchase details, projected by the shared Trip catalogue loader.
  return searchTripActivities(
    { category: null, near: anchor, sort: anchor ? "distance_asc" : "recommended" },
    items.flatMap((item) => item.experience_id ? [item.experience_id] : []),
    db,
    discoveryData,
  );
}

export async function createTripAction(formData: FormData) {
  const db = await createClient();
  const submittedName = parseSubmittedTripName(formData.get("name"));
  const { startDate, endDate } = parseSubmittedTripDates(
    formData.get("start_date"),
    formData.get("end_date"),
  );

  const name = submittedName || nextDefaultTripName([], await getTripNameSequence(db));

  const trip = await createTrip({
    name,
    start_date: startDate,
    end_date: endDate,
  }, db);

  const tripId = trip?.id;

  if (tripId) {
    revalidatePath("/customer/trip");
    redirect(`/customer/trip/${tripId}`);
  }
}

export async function deleteTripAction(tripId: string) {
  const db = await createClient();
  await deleteTrip(tripId, db);
  revalidatePath("/customer/trip");
}

export type TripMutationResult<T> = {ok:true;value:T} | {ok:false};

async function mutateTrip<T>(tripId:string,operation:string,write:()=>Promise<T>):Promise<TripMutationResult<T>> {
  try {
    const value=await write();
    revalidatePath(`/customer/trip/${tripId}`);
    return {ok:true,value};
  } catch(error) {
    // Expected rejection is data, so the framework does not navigate away from preserved UI state.
    // Never log database messages or transport headers: they may contain private input or credentials.
    const code=typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    console.warn("Trip mutation rejected",{operation,code:/^[A-Z0-9_]{2,32}$/.test(code) ? code : "UNAVAILABLE"});
    return {ok:false};
  }
}

export async function addTripItemAction(input: AddTripItemInput) {
  return mutateTrip(input.trip_id,"add",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.addTripItem(input,db));
  });
}

export async function deleteTripItemAction(tripId:string,itemId:string) {
  return mutateTrip(tripId,"remove",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.deleteTripItem(itemId,db));
  });
}

export async function reorderTripItemsAction(tripId:string,reorderedItemIds:string[]) {
  return mutateTrip(tripId,"reorder",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.reorderTripItems(tripId,reorderedItemIds,db));
  });
}

export async function updateTripItemScheduleAction(tripId:string,itemId:string,updates:{scheduled_date:string | null;scheduled_time:string | null}) {
  return mutateTrip(tripId,"schedule",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.updateTripItem(itemId,updates,db));
  });
}

export async function updateTripItemLocationAction(tripId:string,itemId:string,updates:{label:string;lat:number;lng:number}) {
  return mutateTrip(tripId,"location",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.updateTripItemLocation(itemId,updates,db));
  });
}

export async function clearTripItemsAction(tripId:string) {
  return mutateTrip(tripId,"clear",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.clearTripItems(tripId,db));
  });
}

export async function replaceTripItemAction(tripId:string,itemId:string,replacement:{experience_id:string;outlet_id?:string | null}) {
  return mutateTrip(tripId,"replace",async()=>{
    const db=await createClient();
    return import("@/backend/domains/trips").then(m=>m.replaceTripItem(itemId,replacement,db));
  });
}
