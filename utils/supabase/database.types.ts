export type ListingRow = {
  id: string;
  title: string;
  price: number;
  category: string;
  location: string;
  seller_name: string;
  seller_email: string;
  seller_country: string | null;
  seller_address: string | null;
  seller_phone: string | null;
  description: string;
  image_path: string;
  status: "pending_onboarding" | "available" | "reserved" | "sold";
  reserved_order_id: string | null;
  sold_at: string | null;
  created_at: string;
};

export type ListingInsert = Omit<ListingRow, "created_at"> & {
  created_at?: string;
};

export type ListingInquiryRow = {
  id: string;
  listing_id: string;
  buyer_email: string;
  message: string;
  created_at: string;
};

export type ListingInquiryInsert = Omit<
  ListingInquiryRow,
  "id" | "created_at"
> & {
  id?: string;
  created_at?: string;
};

type SellerAccountRow = {
  email: string;
  stripe_account_id: string;
  country: string;
  onboarding_complete: boolean;
  transfers_status: string;
  requirements_count: number;
  onboarding_refresh_token_hash: string | null;
  updated_at: string;
};

type ListingOrderRow = {
  id: string;
  listing_id: string;
  seller_account_id: string;
  buyer_email: string;
  amount_cents: number;
  platform_fee_cents: number;
  seller_amount_cents: number;
  currency: string;
  status: "pending" | "processing" | "paid" | "failed";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  transfer_group: string;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

type SellerEmailVerificationRow = {
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  last_sent_at: string;
  verification_token_hash: string | null;
  verified_until: string | null;
};

type StripeWebhookEventRow = {
  event_id: string;
  processed_at: string;
};

export interface Database {
  public: {
    Tables: {
      listings: {
        Row: ListingRow;
        Insert: ListingInsert;
        Update: Partial<ListingInsert>;
        Relationships: [];
      };
      listing_inquiries: {
        Row: ListingInquiryRow;
        Insert: ListingInquiryInsert;
        Update: Partial<ListingInquiryInsert>;
        Relationships: [
          {
            foreignKeyName: "listing_inquiries_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      seller_accounts: {
        Row: SellerAccountRow;
        Insert: Omit<SellerAccountRow, "updated_at"> & {
          updated_at?: string;
        };
        Update: Partial<SellerAccountRow>;
        Relationships: [];
      };
      listing_orders: {
        Row: ListingOrderRow;
        Insert: Omit<ListingOrderRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ListingOrderRow>;
        Relationships: [];
      };
      seller_email_verifications: {
        Row: SellerEmailVerificationRow;
        Insert: SellerEmailVerificationRow;
        Update: Partial<SellerEmailVerificationRow>;
        Relationships: [];
      };
      stripe_webhook_events: {
        Row: StripeWebhookEventRow;
        Insert: StripeWebhookEventRow;
        Update: Partial<StripeWebhookEventRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      verify_seller_email_code: {
        Args: {
          p_email: string;
          p_code_hash: string;
          p_token_hash: string;
          p_now: string;
        };
        Returns: boolean;
      };
      reserve_listing_for_checkout: {
        Args: {
          p_listing_id: string;
          p_order_id: string;
          p_buyer_email: string;
          p_platform_fee_cents: number;
        };
        Returns: {
          order_id: string;
          amount_cents: number;
          seller_account_id: string;
        }[];
      };
      release_listing_checkout_reservation: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      apply_stripe_checkout_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_order_id: string;
          p_session_id: string;
          p_payment_intent_id: string | null;
          p_buyer_email: string | null;
          p_payment_succeeded: boolean;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
