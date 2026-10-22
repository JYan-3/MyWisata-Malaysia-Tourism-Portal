import {z} from "zod";
import {searchTripActivitiesAction} from "@/app/customer/trip/actions";
import {apiFail,apiOk} from "@/lib/validation/schemas";

const inputSchema=z.object({
  tripId:z.string().min(1).max(128),
  near:z.object({lat:z.coerce.number().min(-90).max(90),lng:z.coerce.number().min(-180).max(180)}).optional(),
});
function privateResponse(response:Response) {
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  response.headers.set("Referrer-Policy","no-referrer");
  return response;
}

export async function GET(request:Request,context:{params:Promise<{tripId:string}>}) {
  const {tripId}=await context.params;
  const query=new URL(request.url).searchParams;
  const hasNear=query.has("lat") || query.has("lng");
  const parsed=inputSchema.safeParse({tripId,near:hasNear ? {lat:query.get("lat") ?? undefined,lng:query.get("lng") ?? undefined} : undefined});
  if(!parsed.success) return privateResponse(apiFail("VALIDATION_FAILED","Invalid Trip discovery request",422));
  try {
    // Reuse the owned Trip projection; this read must not queue behind browser mutations.
    return privateResponse(apiOk(await searchTripActivitiesAction(parsed.data.tripId,parsed.data.near)));
  } catch(error) {
    if(error instanceof Error && error.message === "Authentication required") return privateResponse(apiFail("UNAUTHORIZED","Sign in required",401));
    if(error instanceof Error && error.message === "Trip not found") return privateResponse(apiFail("NOT_FOUND","Trip unavailable",404));
    return privateResponse(apiFail("TRIP_DISCOVERY_UNAVAILABLE","Trip places are temporarily unavailable",503));
  }
}
