"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Bike,
  BookOpen,
  Camera,
  Check,
  Gamepad2,
  Grid2X2,
  Heart,
  House,
  ImagePlus,
  Lamp,
  Laptop,
  MapPin,
  Menu,
  PackagePlus,
  Search,
  Shirt,
  Sofa,
  Sparkles,
  Tag,
  Trees,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/utils/supabase/client";
import type { ListingRow } from "@/utils/supabase/database.types";

const imageBucket = "marketplace-listings";
const pendingCheckoutStorageKey = "fairground.pendingCheckout";
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const categories = [
  "All",
  "Vehicles",
  "Property Rentals",
  "Apparel",
  "Digital",
  "Electronics",
  "Entertainment",
  "Family",
  "Retro Stuff",
  "Garden & Outdoor",
  "Hobbies",
  "Home Goods",
  "Home Improvement",
  "Home Sales",
  "Musical Instruments",
  "Office Supplies",
  "Pet Supplies",
  "Sporting Goods",
  "Toys & Games",
  "Buy and sell groups",
  "Books",
];

const categoryIcons = [
  Grid2X2,
  Bike,
  House,
  Shirt,
  Tag,
  Laptop,
  Camera,
  Heart,
  PackagePlus,
  Trees,
  Sparkles,
  Sofa,
  Lamp,
  House,
  BookOpen,
  PackagePlus,
  Heart,
  Bike,
  Gamepad2,
  Grid2X2,
  BookOpen,
];

type Listing = {
  id: string;
  title: string;
  price: number;
  category: string;
  location: string;
  seller: string;
  image: string;
  description: string;
  posted: string;
  status: ListingRow["status"];
};

type ListingDraft = {
  title: string;
  price: string;
  category: string;
  location: string;
  seller: string;
  sellerEmail: string;
  sellerCountry: string;
  image: string;
  imageFile: File | null;
  description: string;
};

const emptyListingDraft: ListingDraft = {
  title: "",
  price: "",
  category: "Vehicles",
  location: "",
  seller: "",
  sellerEmail: "",
  sellerCountry: "ID",
  image: "",
  imageFile: null,
  description: "",
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);

type PublicListingRow = Pick<
  ListingRow,
  | "id"
  | "title"
  | "price"
  | "category"
  | "location"
  | "seller_name"
  | "description"
  | "image_path"
  | "created_at"
  | "status"
>;

function mapListing(row: PublicListingRow, image: string): Listing {
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    category: row.category,
    location: row.location,
    seller: row.seller_name,
    image,
    description: row.description,
    posted: new Date(row.created_at).toLocaleDateString(),
    status: row.status,
  };
}

type CheckoutResolution = {
  listingId: string;
  status: "available" | "processing" | "sold";
};

async function requestCheckoutReconciliation() {
  const response = await fetch("/api/checkout/reconcile", { method: "POST" });
  const result = (await response.json()) as {
    error?: string;
    failedCount?: number;
    resolutions?: CheckoutResolution[];
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Could not refresh checkout reservations.");
  }
  return {
    failedCount: result.failedCount ?? 0,
    resolutions: result.resolutions ?? [],
  };
}

function listingStatusFromCheckout(
  status: CheckoutResolution["status"],
): Listing["status"] {
  return status === "processing" ? "reserved" : status;
}

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [listingsError, setListingsError] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notification, setNotification] = useState("");
  const [draft, setDraft] = useState(emptyListingDraft);
  const [imageUploadError, setImageUploadError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSavingListing, setIsSavingListing] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [sellerEmailVerified, setSellerEmailVerified] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;

    async function loadListings() {
      setIsLoadingListings(true);
      setListingsError("");

      try {
        try {
          const reconciliation = await requestCheckoutReconciliation();
          if (reconciliation.failedCount > 0 && !cancelled) {
            setNotification(
              "Some checkout reservations could not be refreshed. We’ll retry automatically.",
            );
          }
        } catch (error) {
          console.error("Could not refresh checkout reservations:", error);
          if (!cancelled) {
            setNotification(
              "Could not refresh checkout reservations. We’ll retry automatically.",
            );
          }
        }

        const { data, error } = await supabase
          .from("listings")
          .select(
            "id,title,price,category,location,seller_name,description,image_path,created_at,status",
          )
          .neq("status", "pending_onboarding")
          .order("created_at", { ascending: false });

        if (cancelled) return;
        if (error) {
          setListingsError(error.message);
          setListings([]);
          return;
        }

        const loadedListings = data.map((row) => {
          const imageUrl = row.image_path.startsWith(
            "https://images.unsplash.com/",
          )
            ? row.image_path
            : supabase.storage
                .from(imageBucket)
                .getPublicUrl(row.image_path).data.publicUrl;
          return mapListing(row, imageUrl);
        });
        setListings(loadedListings);

        const params = new URLSearchParams(window.location.search);
        const canceledListingId =
          params.get("checkout") === "cancelled"
            ? params.get("listing_id")
            : null;
        const canceledListing = loadedListings.find(
          (listing) => listing.id === canceledListingId,
        );
        if (canceledListing?.status === "available") {
          setSelectedListing(canceledListing);
        }
      } catch (error) {
        if (!cancelled) {
          setListingsError(
            error instanceof Error
              ? error.message
              : "Could not load marketplace listings.",
          );
          setListings([]);
        }
      } finally {
        if (!cancelled) setIsLoadingListings(false);
      }
    }

    void loadListings();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let requestInProgress = false;

    async function reconcileReservations() {
      if (requestInProgress) return;
      requestInProgress = true;
      try {
        const reconciliation = await requestCheckoutReconciliation();
        const statuses = new Map(
          reconciliation.resolutions.map((item) => [
            item.listingId,
            listingStatusFromCheckout(item.status),
          ]),
        );
        setListings((current) =>
          current.map((listing) => {
            const status = statuses.get(listing.id);
            return status ? { ...listing, status } : listing;
          }),
        );
        setSelectedListing((current) => {
          if (!current) return current;
          const status = statuses.get(current.id);
          return status ? { ...current, status } : current;
        });
        if (reconciliation.failedCount > 0) {
          setNotification(
            "Some checkout reservations could not be refreshed. We’ll retry automatically.",
          );
        }
      } catch (error) {
        console.error("Could not refresh checkout reservations:", error);
        setNotification(
          "Could not refresh checkout reservations. We’ll retry automatically.",
        );
      } finally {
        requestInProgress = false;
      }
    }

    function reconcileWhenVisible() {
      if (document.visibilityState === "visible") {
        void reconcileReservations();
      }
    }

    const interval = window.setInterval(reconcileWhenVisible, 60_000);
    document.addEventListener("visibilitychange", reconcileWhenVisible);
    window.addEventListener("pageshow", reconcileWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", reconcileWhenVisible);
      window.removeEventListener("pageshow", reconcileWhenVisible);
    };
  }, []);

  useEffect(() => {
    const previewUrl = draft.image;
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [draft.image]);

  const filteredListings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return listings.filter((listing) => {
      const matchesCategory =
        activeCategory === "All" || listing.category === activeCategory;
      const matchesSearch =
        !query ||
        `${listing.title} ${listing.description} ${listing.location} ${listing.category}`
          .toLowerCase()
          .includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, listings, search]);

  function showNotification(message: string) {
    setNotification(message);
    window.setTimeout(() => setNotification(""), 3200);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    const checkout = params.get("checkout");
    const message =
      connect === "complete"
        ? "Your listing is live. Stripe confirmed your seller account is ready."
        : connect === "pending"
          ? "Your listing was saved, but stays hidden until Stripe confirms your seller account is ready to accept payments."
          : connect === "check_failed"
            ? "Your listing was saved, but we couldn’t verify your Stripe status. Please try again."
            : checkout === "cancelled"
              ? "Checkout was canceled. You can buy this listing again."
              : checkout === "processing"
                ? "Payment is still processing. This listing remains reserved until Stripe confirms the result."
                : checkout === "complete"
                  ? "Payment completed. This listing is sold."
                  : checkout === "cancel_failed"
                    ? "We couldn’t confirm checkout cancellation. The listing remains reserved for now."
              : "";

    if (message) {
      const notificationTimeout = window.setTimeout(() => {
        setNotification(message);
      }, 0);
      const dismissTimeout = window.setTimeout(() => setNotification(""), 5000);
      return () => {
        window.clearTimeout(notificationTimeout);
        window.clearTimeout(dismissTimeout);
      };
    }
  }, []);

  useEffect(() => {
    let requestInProgress = false;

    async function resumePendingCheckout() {
      if (requestInProgress) return;

      const storedCheckout = sessionStorage.getItem(pendingCheckoutStorageKey);
      if (!storedCheckout) return;

      let pendingCheckout: { orderId: string; listingId: string };
      try {
        pendingCheckout = JSON.parse(storedCheckout) as {
          orderId: string;
          listingId: string;
        };
      } catch {
        sessionStorage.removeItem(pendingCheckoutStorageKey);
        return;
      }

      requestInProgress = true;
      try {
        const response = await fetch("/api/checkout/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: pendingCheckout.orderId }),
        });
        const result = (await response.json()) as {
          error?: string;
          listingId?: string;
          status?: "available" | "processing" | "sold";
        };
        if (!response.ok || !result.status) {
          throw new Error(
            result.error ?? "Could not confirm checkout status.",
          );
        }

        sessionStorage.removeItem(pendingCheckoutStorageKey);
        const listingId = result.listingId ?? pendingCheckout.listingId;
        const status =
          result.status === "available"
            ? "available"
            : result.status === "sold"
              ? "sold"
              : "reserved";
        setListings((current) =>
          current.map((listing) =>
            listing.id === listingId ? { ...listing, status } : listing,
          ),
        );
        setSelectedListing((current) =>
          current?.id === listingId ? { ...current, status } : current,
        );
        setNotification(
          result.status === "available"
            ? "Checkout was canceled. You can buy this listing again."
            : result.status === "sold"
              ? "Payment completed. This listing is sold."
              : "Payment is still processing. This listing remains reserved.",
        );
        window.setTimeout(() => setNotification(""), 5000);
      } catch (error) {
        setNotification(
          error instanceof Error
            ? error.message
            : "Could not confirm checkout cancellation.",
        );
        window.setTimeout(() => setNotification(""), 5000);
      } finally {
        requestInProgress = false;
      }
    }

    window.addEventListener("pageshow", resumePendingCheckout);
    void resumePendingCheckout();
    return () => {
      window.removeEventListener("pageshow", resumePendingCheckout);
    };
  }, []);

  function updateDraft<Key extends keyof ListingDraft>(
    key: Key,
    value: ListingDraft[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleImageUpload(file: File | undefined, input: HTMLInputElement) {
    setImageUploadError("");
    if (!file) {
      setDraft((current) => ({ ...current, image: "", imageFile: null }));
      return;
    }
    if (!imageExtensions[file.type]) {
      setImageUploadError("Choose a JPG, PNG, WebP, GIF, or AVIF image.");
      input.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageUploadError("Choose an image smaller than 5 MB.");
      input.value = "";
      return;
    }

    setDraft((current) => ({
      ...current,
      image: URL.createObjectURL(file),
      imageFile: file,
    }));
  }

  async function handleCreateListing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.imageFile) {
      setFormError("Upload a listing photo before publishing.");
      return;
    }

    setIsSavingListing(true);
    setFormError("");

    try {
      const sellerEmail = draft.sellerEmail.trim().toLowerCase();

      if (!sellerEmailVerified) {
        if (!verificationSent) {
          const sendResponse = await fetch("/api/seller-verification", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: sellerEmail }),
          });
          const sendResult = (await sendResponse.json()) as { error?: string };
          if (!sendResponse.ok) {
            setFormError(sendResult.error ?? "Could not send the verification code.");
            return;
          }
          setVerificationSent(true);
          showNotification("Check your email for the seller verification code.");
          return;
        }

        const verifyResponse = await fetch("/api/seller-verification/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: sellerEmail, code: verificationCode }),
        });
        const verifyResult = (await verifyResponse.json()) as {
          error?: string;
          verified?: boolean;
        };
        if (!verifyResponse.ok || !verifyResult.verified) {
          setFormError(verifyResult.error ?? "Could not verify the seller email.");
          return;
        }
        setSellerEmailVerified(true);
      }

      const id = crypto.randomUUID();
      const imagePath = `${id}.${imageExtensions[draft.imageFile.type]}`;
      const { error: uploadError } = await supabase.storage
        .from(imageBucket)
        .upload(imagePath, draft.imageFile, {
          cacheControl: "3600",
          contentType: draft.imageFile.type,
          upsert: false,
        });

      if (uploadError) {
        setFormError(`Photo upload failed: ${uploadError.message}`);
        return;
      }

      const listingData = {
        id,
        title: draft.title.trim(),
        price: Number(draft.price),
        category: draft.category,
        location: draft.location.trim(),
        seller_name: draft.seller.trim(),
        seller_email: sellerEmail,
        seller_country: draft.sellerCountry.trim().toUpperCase(),
        seller_address: null,
        seller_phone: null,
        description: draft.description.trim(),
        image_path: imagePath,
        status: "pending_onboarding" as const,
        reserved_order_id: null,
        sold_at: null,
      };
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: listingData.title,
          price: listingData.price,
          category: listingData.category,
          location: listingData.location,
          sellerName: listingData.seller_name,
          sellerEmail: listingData.seller_email,
          sellerCountry: listingData.seller_country,
          description: listingData.description,
          imagePath,
        }),
      });
      const result = (await response.json()) as {
        created?: boolean;
        error?: string;
        sellerOnboardingComplete?: boolean;
        onboardingUrl?: string;
      };

      if (!response.ok || !result.created) {
        const { error: cleanupError } = await supabase.storage
          .from(imageBucket)
          .remove([imagePath]);
        setFormError(
          cleanupError
            ? `${result.error ?? "Listing save failed."} The uploaded photo could not be removed: ${cleanupError.message}`
            : result.error ?? "Listing save failed.",
        );
        return;
      }

      if (!result.sellerOnboardingComplete) {
        if (!result.onboardingUrl) {
          setFormError(
            "The listing is saved, but Stripe did not return an onboarding link. Try submitting again to continue.",
          );
          return;
        }

        showNotification("Continue to Stripe to finish seller onboarding.");
        window.location.assign(result.onboardingUrl);
        return;
      }

      const imageUrl = supabase.storage
        .from(imageBucket)
        .getPublicUrl(imagePath).data.publicUrl;
      setListings((current) => [
        mapListing(
          {
            ...listingData,
            status: "available",
            created_at: new Date().toISOString(),
          },
          imageUrl,
        ),
        ...current,
      ]);

      setActiveCategory("All");
      setSearch("");
      setIsFormOpen(false);
      setDraft(emptyListingDraft);
      setVerificationSent(false);
      setVerificationCode("");
      setSellerEmailVerified(false);
      setImageUploadError("");
      showNotification("Your listing is live.");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not publish listing.",
      );
    } finally {
      setIsSavingListing(false);
    }
  }

  async function handleBuyNow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedListing) return;

    const formData = new FormData(event.currentTarget);
    const buyerEmail = String(formData.get("buyerEmail")).trim().toLowerCase();
    setIsStartingCheckout(true);
    setCheckoutError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: selectedListing.id,
          buyerEmail,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        checkoutUrl?: string;
        orderId?: string;
      };

      if (!response.ok || !result.checkoutUrl || !result.orderId) {
        setCheckoutError(result.error ?? "Could not start checkout.");
        return;
      }

      sessionStorage.setItem(
        pendingCheckoutStorageKey,
        JSON.stringify({ orderId: result.orderId, listingId: selectedListing.id }),
      );
      setListings((current) =>
        current.map((listing) =>
          listing.id === selectedListing.id
            ? { ...listing, status: "reserved" }
            : listing,
        ),
      );
      setSelectedListing({ ...selectedListing, status: "reserved" });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "Could not start checkout.",
      );
    } finally {
      setIsStartingCheckout(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-[#171717]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-neutral-200 bg-white px-6 py-7 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-3 text-left"
              onClick={() => {
                setActiveCategory("All");
                setSearch("");
                setIsSidebarOpen(false);
              }}
              aria-label="Go to all listings"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#f1f5ea] text-[19px] font-black text-[#587a3b]">
                f.
              </span>
              <span className="text-lg font-bold tracking-tight">fairground</span>
            </button>
            <button
              className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 lg:hidden"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close categories"
            >
              <X className="size-5" />
            </button>
          </div>

          <Button
            className="mt-9 w-full justify-center"
            onClick={() => {
              setIsFormOpen(true);
              setIsSidebarOpen(false);
            }}
          >
            <PackagePlus className="size-4" />
            Add a listing
          </Button>

          <div className="mt-10 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Categories</h2>
            <span className="text-xs text-neutral-400">{listings.length}</span>
          </div>
          <nav
            aria-label="Listing categories"
            className="mt-3 flex-1 space-y-0.5 overflow-y-auto pr-1 bg-gray-100 rounded p-5 space-y-3"
          >
            {categories.map((category, index) => {
              const Icon = categoryIcons[index];
              const count =
                category === "All"
                  ? listings.length
                  : listings.filter((listing) => listing.category === category)
                      .length;
              return (
                <button
                  key={category}
                  onClick={() => {
                    setActiveCategory(category);
                    setIsSidebarOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                    activeCategory === category
                      ? "bg-[#587a3b]/20 font-semibold text-[#486630]"
                      : "text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900"
                  }`}
                  aria-current={activeCategory === category ? "page" : undefined}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span className="flex-1">{category}</span>
                  {count > 0 && (
                    <span
                      className={`text-xs ${
                        activeCategory === category
                          ? "text-[#486630]"
                          : "text-neutral-400"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {isSidebarOpen && (
          <button
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1 px-5 pb-12 pt-5 sm:px-8 sm:pt-8 lg:px-10 lg:pt-9">
          <header className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="rounded-lg p-2 text-neutral-600 hover:bg-white lg:hidden"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open categories"
              >
                <Menu className="size-5" />
              </button>
              <div>
                <p className="hidden text-sm text-neutral-500 sm:block">
                  Next-level marketplace
                </p>
                <h1 className="text-xl font-bold tracking-tight sm:mt-1 sm:text-2xl">
                  {activeCategory === "All" ? "Marketplace listings" : activeCategory}
                </h1>
              </div>
            </div>
          </header>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search for anything..."
                aria-label="Search listings"
                className="h-11 pl-10"
              />
            </label>
          </div>

          <div className="mt-7 flex items-center justify-between">
            <p className="text-sm text-neutral-500 flex justify-between w-full">
              {isLoadingListings ? (
                "Loading listings..."
              ) : (
                <>
                  <span className="font-medium text-neutral-900">
                    {filteredListings.length} listings
                  </span>{" "}
                  {activeCategory}
                </>
              )}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-neutral-500 lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              Categories
            </Button>
          </div>

          {listingsError ? (
            <div
              role="alert"
              className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-red-200 bg-white px-6 text-center"
            >
              <h2 className="font-semibold">Couldn’t load listings</h2>
              <p className="mt-2 max-w-md text-sm text-neutral-500">
                {listingsError}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          ) : isLoadingListings ? (
            <div className="mt-8 flex min-h-[280px] items-center justify-center rounded-2xl bg-white text-sm text-neutral-500">
              Loading marketplace listings...
            </div>
          ) : filteredListings.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-2 sm:gap-x-5 sm:gap-y-8 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredListings.map((listing) => (
                <button
                  key={listing.id}
                  className="group min-w-0 text-left"
                  onClick={() => setSelectedListing(listing)}
                  aria-label={`${listing.title}, ${formatPrice(listing.price)}`}
                >
                  <Card className="overflow-hidden border border-neutral-200 shadow-none hover:-translate-y-2 transition-all hover:border-neutral-500">
                    <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
                      <div
                        role="img"
                        aria-label={`${listing.title}${listing.status === "sold" ? ", sold out" : ""}`}
                        className="h-full w-full bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.04]"
                        style={{ backgroundImage: `url("${listing.image}")` }}
                      />
                      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium text-neutral-600 backdrop-blur">
                        {listing.category}
                      </span>
                    </div>
                    <CardContent className="px-3 pb-3 pt-3">
                      <p className="text-sm font-semibold tracking-tight text-[#587a3b]">
                        {formatPrice(listing.price)}
                      </p>
                      <h3 className="mt-0.5 truncate text-base font-bold text-neutral-800">
                        {listing.title}
                      </h3>
                      {listing.status === "reserved" && (
                        <p className="mt-1 text-xs font-medium text-amber-700">
                          Checkout in progress
                        </p>
                      )}
                      {listing.status === "sold" && (
                        <p className="mt-1 text-xs font-medium text-neutral-500">
                          Sold out
                        </p>
                      )}
                      <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                        <MapPin className="size-3" />
                        {listing.location}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white px-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-[#f1f5ea] text-[#587a3b]">
                <Search className="size-5" />
              </span>
              <h2 className="mt-4 font-semibold">
                {listings.length === 0 ? "No listings yet" : "No listings found"}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-neutral-500">
                {listings.length === 0
                  ? "Be the first to add something to your neighborhood marketplace."
                  : "Try another search or choose a different category."}
              </p>
              {listings.length === 0 ? (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setIsFormOpen(true)}
                >
                  <PackagePlus className="size-4" />
                  Add a listing
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearch("");
                    setActiveCategory("All");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </main>
      </div>

      {(isFormOpen || selectedListing) && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsFormOpen(false);
              setSelectedListing(null);
            }
          }}
        >
          {isFormOpen ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-listing-title"
              className="grid max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl lg:grid-cols-[1.05fr_0.95fr] lg:overflow-hidden"
            >
              <div className="max-h-[92vh] overflow-y-auto p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2
                      id="create-listing-title"
                      className="text-xl font-bold tracking-tight"
                    >
                      Create a listing
                    </h2>
                    <p className="mt-1 text-sm text-neutral-500">
                      Give your good stuff a new home.
                    </p>
                  </div>
                  <button
                    className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    onClick={() => setIsFormOpen(false)}
                    aria-label="Close form"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <form onSubmit={handleCreateListing} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="listing-title" className="mb-1.5 block text-sm font-medium">
                      Title
                    </label>
                    <Input
                      id="listing-title"
                      name="title"
                      placeholder="What are you selling?"
                      value={draft.title}
                      onChange={(event) => updateDraft("title", event.target.value)}
                      minLength={2}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="listing-price" className="mb-1.5 block text-sm font-medium">
                        Price
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                          $
                        </span>
                        <Input
                          id="listing-price"
                          name="price"
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          className="pl-7"
                          value={draft.price}
                          onChange={(event) => updateDraft("price", event.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="listing-category" className="mb-1.5 block text-sm font-medium">
                        Category
                      </label>
                      <select
                        id="listing-category"
                        name="category"
                        className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-700 outline-none focus-visible:border-[#88a16c] focus-visible:ring-2 focus-visible:ring-[#88a16c]/20"
                        value={draft.category}
                        onChange={(event) => updateDraft("category", event.target.value)}
                      >
                        {categories.slice(1).map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="listing-location" className="mb-1.5 block text-sm font-medium">
                      Listing location
                    </label>
                    <Input
                      id="listing-location"
                      name="location"
                      placeholder="City, State"
                      value={draft.location}
                      onChange={(event) => updateDraft("location", event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="listing-description" className="mb-1.5 block text-sm font-medium">
                      Description
                    </label>
                    <Textarea
                      id="listing-description"
                      name="description"
                      placeholder="Share a few details about your item..."
                      value={draft.description}
                      onChange={(event) => updateDraft("description", event.target.value)}
                      minLength={5}
                      required
                    />
                  </div>

                  <div className="rounded-xl border border-neutral-200 p-4">
                    <div className="mb-3">
                      <p className="text-sm font-semibold">Seller details</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        Verify your email before connecting or reusing a Stripe
                        seller account. Stripe collects the required payout details.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="seller-name" className="mb-1.5 block text-xs font-medium text-neutral-700">
                          Full name
                        </label>
                        <Input
                          id="seller-name"
                          name="seller"
                          autoComplete="name"
                          placeholder="Your name"
                          value={draft.seller}
                          onChange={(event) => updateDraft("seller", event.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="seller-email" className="mb-1.5 block text-xs font-medium text-neutral-700">
                          Email
                        </label>
                        <Input
                          id="seller-email"
                          name="sellerEmail"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={draft.sellerEmail}
                          onChange={(event) => {
                            updateDraft("sellerEmail", event.target.value);
                            setVerificationSent(false);
                            setVerificationCode("");
                            setSellerEmailVerified(false);
                          }}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="seller-country" className="mb-1.5 block text-xs font-medium text-neutral-700">
                          Seller country code
                        </label>
                        <Input
                          id="seller-country"
                          name="sellerCountry"
                          autoComplete="country"
                          placeholder="ID"
                          maxLength={2}
                          value={draft.sellerCountry}
                          onChange={(event) =>
                            updateDraft("sellerCountry", event.target.value.toUpperCase())
                          }
                          required
                        />
                        <p className="mt-1 text-xs text-neutral-400">
                          Use the seller’s two-letter ISO country code, such as ID or US.
                        </p>
                      </div>
                      {verificationSent && !sellerEmailVerified && (
                        <div>
                          <label htmlFor="seller-verification-code" className="mb-1.5 block text-xs font-medium text-neutral-700">
                            Email verification code
                          </label>
                          <Input
                            id="seller-verification-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            pattern="[0-9]{6}"
                            value={verificationCode}
                            onChange={(event) =>
                              setVerificationCode(
                                event.target.value.replace(/\D/g, "").slice(0, 6),
                              )
                            }
                            required
                          />
                        </div>
                      )}
                      {sellerEmailVerified && (
                        <p className="text-xs font-medium text-green-700">
                          Seller email verified.
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="listing-image" className="mb-1.5 block text-sm font-medium">
                      Listing photo
                    </label>
                    <Input
                      id="listing-image"
                      name="image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      className="h-auto cursor-pointer px-2 py-2 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[#f1f5ea] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#4c6935]"
                      onChange={(event) =>
                        handleImageUpload(event.target.files?.[0], event.target)
                      }
                      required
                    />
                    <p className="mt-1.5 text-xs text-neutral-400">
                      Upload a JPG, PNG, WebP, GIF, or AVIF image (up to 5 MB).
                    </p>
                    {imageUploadError && (
                      <p role="alert" className="mt-1.5 text-xs text-red-600">
                        {imageUploadError}
                      </p>
                    )}
                  </div>
                  {formError && (
                    <p role="alert" className="text-sm text-red-600">
                      {formError}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="mt-2 w-full justify-center"
                    disabled={!draft.imageFile || isSavingListing}
                  >
                    {isSavingListing
                      ? "Processing..."
                      : sellerEmailVerified
                        ? "Create listing"
                        : verificationSent
                          ? "Verify and continue"
                          : "Verify email and continue"}
                    <ArrowRight className="size-4" />
                  </Button>
                </form>
              </div>
              <aside className="border-t border-neutral-200 bg-[#f7f7f5] flex flex-col justify-center p-6 sm:p-8 lg:max-h-[92vh] lg:overflow-y-auto lg:border-l lg:border-t-0">
                <p className="text-md font-semibold">Live preview</p>
                <Card className="mt-5 overflow-hidden border border-neutral-200 shadow-sm">
                  <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
                    {draft.image ? (
                      <Image
                        src={draft.image}
                        alt={draft.title || "Listing preview"}
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 40vw, 100vw"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
                        <ImagePlus className="size-8" strokeWidth={1.5} />
                        <span className="text-xs">Your photo will appear here</span>
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium text-neutral-600 backdrop-blur">
                      {draft.category}
                    </span>
                  </div>
                  <CardContent className="p-4">
                    <p className="text-lg font-semibold tracking-tight text-neutral-900">
                      {draft.price ? formatPrice(Number(draft.price)) : "$0"}
                    </p>
                    <h3 className="mt-0.5 truncate text-sm text-neutral-700">
                      {draft.title || "Your listing title"}
                    </h3>
                    <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                      <MapPin className="size-3" />
                      {draft.location || "Your location"}
                    </p>
                    <div className="my-4 border-t border-neutral-100" />
                    <p className="line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-neutral-500">
                      {draft.description || "Your item description will appear here."}
                    </p>
                    <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-4">
                      <span className="flex size-8 items-center justify-center rounded-full bg-[#f1f5ea] text-[#587a3b]">
                        <UserRound className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-800">
                          {draft.seller || "Seller name"}
                        </p>
                        <p className="truncate text-[11px] text-neutral-400">
                          {draft.sellerEmail || "seller@example.com"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </aside>
            </div>
          ) : (
            selectedListing && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="listing-detail-title"
                className="relative grid max-h-[92vh] w-full max-w-[900px] overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-[1.1fr_0.9fr]"
              >
                <button
                  className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-neutral-600 shadow-sm backdrop-blur hover:bg-white"
                  onClick={() => setSelectedListing(null)}
                  aria-label="Close listing"
                >
                  <X className="size-5" />
                </button>
                <div
                  className="min-h-[270px] bg-cover bg-center md:min-h-[540px]"
                  role="img"
                  aria-label={selectedListing.title}
                  style={{ backgroundImage: `url("${selectedListing.image}")` }}
                />
                <div className="flex max-h-[92vh] flex-col overflow-y-auto p-6 sm:p-8">
                  <span className="w-fit rounded-full bg-[#f1f5ea] px-3 py-1 text-xs font-medium text-[#587a3b]">
                    {selectedListing.category}
                  </span>
                  <h2
                    id="listing-detail-title"
                    className="mt-4 text-2xl font-bold tracking-tight"
                  >
                    {selectedListing.title}
                  </h2>
                  <p className="mt-1 text-2xl font-semibold text-[#587a3b]">
                    {formatPrice(selectedListing.price)}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-500">
                    <MapPin className="size-4" />
                    {selectedListing.location} · Listed {selectedListing.posted}
                  </p>
                  <div className="my-6 border-t border-neutral-100" />
                  <p className="text-sm font-semibold">About this item</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    {selectedListing.description}
                  </p>
                  <div className="mt-6 rounded-xl bg-[#f7f7f5] p-4">
                    <p className="text-xs text-neutral-500">Seller</p>
                    <p className="mt-1 font-medium">{selectedListing.seller}</p>
                  </div>
                  {selectedListing.status === "available" ? (
                    <form onSubmit={handleBuyNow} className="mt-6">
                      <label
                        htmlFor="buyer-email"
                        className="mb-1.5 block text-sm font-medium"
                      >
                        Your email address
                      </label>
                      <Input
                        id="buyer-email"
                        name="buyerEmail"
                        type="email"
                        autoComplete="email"
                        placeholder="Your email address"
                        required
                      />
                      {checkoutError && (
                        <p role="alert" className="mt-2 text-sm text-red-600">
                          {checkoutError}
                        </p>
                      )}
                      <Button
                        type="submit"
                        className="mt-3 w-full justify-center"
                        disabled={isStartingCheckout}
                      >
                        {isStartingCheckout ? "Opening secure checkout..." : "Buy now"}
                      </Button>
                    </form>
                  ) : (
                    <p className="mt-6 rounded-lg bg-neutral-100 p-3 text-sm font-medium text-neutral-600">
                      {selectedListing.status === "sold"
                        ? "This listing is sold out."
                        : "Checkout is already in progress for this listing."}
                    </p>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {notification && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-xl"
        >
          <Check className="size-4 text-[#b8d398]" />
          {notification}
        </div>
      )}
    </div>
  );
}
