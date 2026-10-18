import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ uploads: [] as Array<{ bucket: string; path: string }> }));

vi.mock("@/lib/vendor-authorization", () => ({
  authorizeOutlet: vi.fn(async () => ({
    ok: true,
    access: {
      userId: "u1", vendorId: "v1",
      serviceDb: {
        storage: {
          from: (bucket: string) => ({
            upload: async (path: string) => { state.uploads.push({ bucket, path }); return { error: null }; },
            getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
          }),
        },
      },
    },
  })),
}));
vi.mock("@/lib/customer/hotel-outlet", () => ({ isHotelOutlet: vi.fn(async () => true) }));

const route = await import("../route");
const params = { params: Promise.resolve({ vendorId: "v1", outletId: "o1" }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(file: File) {
  const form = new FormData();
  form.append("file", file);
  return route.POST(new Request("http://localhost/x", { method: "POST", body: form }), params);
}

describe("hotel profile photo upload", () => {
  beforeEach(() => { state.uploads = []; });

  it("stores a real image under the hotel's own folder and returns its URL", async () => {
    const response = await upload(new File([PNG], "room.png", { type: "image/png" }));
    expect(response.status).toBe(201);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].bucket).toBe("vendor-products");
    expect(state.uploads[0].path).toMatch(/^v1\/hotel\/o1\/[0-9a-f-]+\.png$/);
    expect((await response.json()).data.url).toContain("/vendor-products/v1/hotel/o1/");
  });

  it("rejects files that are not images or whose bytes do not match", async () => {
    expect((await upload(new File(["hello"], "notes.txt", { type: "text/plain" }))).status).toBe(422);
    expect((await upload(new File(["not really a png"], "fake.png", { type: "image/png" }))).status).toBe(422);
    expect(state.uploads).toHaveLength(0);
  });
});
