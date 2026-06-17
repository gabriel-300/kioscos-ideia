// Generado con: npx supabase gen types typescript --project-id <id> > src/types/database.ts
// Este archivo se sobreescribe automáticamente. No editar manualmente.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole =
  | "customer_b2c"
  | "customer_b2b"
  | "repartidor"
  | "admin_enminutas"
  | "admin_ideaia";

export type OrderStatus =
  | "pending_payment"
  | "payment_review"
  | "paid"
  | "preparing"
  | "ready"
  | "in_delivery"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "aprobado"
  | "enviado_prod"
  | "despachado"
  | "en_distribucion";

export type OrderChannel =
  | "b2c_nacional"
  | "b2b_mayorista"
  | "pedido_ya_local";

export type B2bStatus = "pending" | "approved" | "rejected" | "suspended";

export type ClientCanal = "dist" | "gastro" | "min";
export type B2bProfileStatus = "pendiente" | "activo" | "inactivo";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          phone: string | null;
          document_type: string | null;
          document_number: string | null;
          canal: ClientCanal | null;
          zona_id: string | null;
          b2b_status: B2bProfileStatus | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          full_name?: string | null;
          phone?: string | null;
          document_type?: string | null;
          document_number?: string | null;
          canal?: ClientCanal | null;
          zona_id?: string | null;
          b2b_status?: B2bProfileStatus | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          role?: UserRole;
          full_name?: string | null;
          phone?: string | null;
          document_type?: string | null;
          document_number?: string | null;
          canal?: ClientCanal | null;
          zona_id?: string | null;
          b2b_status?: B2bProfileStatus | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          image_url: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          image_url?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          slug?: string;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          sort_order?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          sku: string;
          slug: string;
          name: string;
          short_description: string | null;
          description: string | null;
          category_id: string | null;
          price_b2c: number;
          price_b2b: number;
          min_quantity_b2b: number;
          unit_label: string;
          weight_grams: number | null;
          freezer_required: boolean;
          is_active: boolean;
          cover_image_url: string | null;
          gallery_urls: Json;
          metadata: Json;
          costo: number | null;
          kg_caja: number | null;
          bolsas_caja: number | null;
          pkg_unitario: number | null;
          pkg_bulto: number | null;
          margen_dist: number | null;
          margen_gastro: number | null;
          margen_min: number | null;
          mult_bolsas: boolean | null;
          precio_dist: number | null;
          precio_gastro: number | null;
          precio_min: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sku: string;
          slug: string;
          name: string;
          short_description?: string | null;
          description?: string | null;
          category_id?: string | null;
          price_b2c: number;
          price_b2b: number;
          min_quantity_b2b?: number;
          unit_label?: string;
          weight_grams?: number | null;
          freezer_required?: boolean;
          is_active?: boolean;
          cover_image_url?: string | null;
          gallery_urls?: Json;
          metadata?: Json;
          costo?: number | null;
          kg_caja?: number | null;
          bolsas_caja?: number | null;
          pkg_unitario?: number | null;
          pkg_bulto?: number | null;
          margen_dist?: number | null;
          margen_gastro?: number | null;
          margen_min?: number | null;
          mult_bolsas?: boolean | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          sku?: string;
          slug?: string;
          name?: string;
          short_description?: string | null;
          description?: string | null;
          category_id?: string | null;
          price_b2c?: number;
          price_b2b?: number;
          min_quantity_b2b?: number;
          unit_label?: string;
          weight_grams?: number | null;
          freezer_required?: boolean;
          is_active?: boolean;
          cover_image_url?: string | null;
          gallery_urls?: Json;
          metadata?: Json;
          costo?: number | null;
          kg_caja?: number | null;
          bolsas_caja?: number | null;
          pkg_unitario?: number | null;
          pkg_bulto?: number | null;
          margen_dist?: number | null;
          margen_gastro?: number | null;
          margen_min?: number | null;
          mult_bolsas?: boolean | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          }
        ];
      };
      orders: {
        Row: {
          id: string;
          order_number: string;
          channel: OrderChannel;
          customer_id: string | null;
          guest_email: string | null;
          guest_phone: string | null;
          status: OrderStatus;
          subtotal: number;
          shipping_fee: number;
          discount: number;
          total: number;
          ideaia_commission_rate: number;
          ideaia_commission_amount: number;
          shipping_method: string;
          shipping_address_id: string | null;
          shipping_snapshot: Json | null;
          delivery_zone_id: string | null;
          assigned_driver_id: string | null;
          tracking_number: string | null;
          payment_method: string;
          payment_declared_at: string | null;
          payment_confirmed_at: string | null;
          payment_confirmed_by: string | null;
          payment_proof_url: string | null;
          mp_preference_id: string | null;
          mp_payment_id: string | null;
          notes: string | null;
          aprobado_por: string | null;
          aprobado_at: string | null;
          despachado_at: string | null;
          entregado_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["orders"]["Row"]> & {
          channel: OrderChannel;
          subtotal: number;
          total: number;
          ideaia_commission_rate: number;
          ideaia_commission_amount: number;
          shipping_method: string;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Row"]>;
        Relationships: [];
      };
      platform_settings: {
        Row: {
          id: number;
          ideaia_commission_rate: number;
          bank_cbu: string;
          bank_alias: string;
          bank_holder: string;
          cuit_emisor: string;
          whatsapp_phone_display: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          ideaia_commission_rate?: number;
          bank_cbu: string;
          bank_alias: string;
          bank_holder: string;
          cuit_emisor: string;
          whatsapp_phone_display?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_settings"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      order_status: OrderStatus;
      order_channel: OrderChannel;
      b2b_status: B2bStatus;
    };
  };
}
