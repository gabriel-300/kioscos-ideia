// Generado con: npx supabase gen types typescript --project-id <id> > src/types/database.ts
// Este archivo se sobreescribe automáticamente. No editar manualmente.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aperturas_caja: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          fondo_inicial: number
          id: string
          notas: string | null
          sucursal_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha: string
          fondo_inicial?: number
          id?: string
          notas?: string | null
          sucursal_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          fondo_inicial?: number
          id?: string
          notas?: string | null
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aperturas_caja_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      cierres_caja: {
        Row: {
          billetera_declarada: number
          created_at: string
          created_by: string | null
          diferencia: number | null
          efectivo_declarado: number
          fecha: string
          fondo_inicial: number
          id: string
          notas: string | null
          sucursal_id: string
          tarjeta_declarada: number
          total_ventas: number
          transferencia_declarada: number
        }
        Insert: {
          billetera_declarada?: number
          created_at?: string
          created_by?: string | null
          diferencia?: number | null
          efectivo_declarado?: number
          fecha: string
          fondo_inicial?: number
          id?: string
          notas?: string | null
          sucursal_id: string
          tarjeta_declarada?: number
          total_ventas?: number
          transferencia_declarada?: number
        }
        Update: {
          billetera_declarada?: number
          created_at?: string
          created_by?: string | null
          diferencia?: number | null
          efectivo_declarado?: number
          fecha?: string
          fondo_inicial?: number
          id?: string
          notas?: string | null
          sucursal_id?: string
          tarjeta_declarada?: number
          total_ventas?: number
          transferencia_declarada?: number
        }
        Relationships: [
          {
            foreignKeyName: "cierres_caja_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      cta_corriente_pagos: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          monto: number
          notas: string | null
          personal_id: string
          sucursal_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto: number
          notas?: string | null
          personal_id: string
          sucursal_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          personal_id?: string
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cta_corriente_pagos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      movimiento_items: {
        Row: {
          cantidad: number
          created_at: string
          id: string
          movimiento_id: string
          precio_unitario: number | null
          product_id: string
          promo_id: string | null
          subtotal: number | null
        }
        Insert: {
          cantidad: number
          created_at?: string
          id?: string
          movimiento_id: string
          precio_unitario?: number | null
          product_id: string
          promo_id?: string | null
          subtotal?: number | null
        }
        Update: {
          cantidad?: number
          created_at?: string
          id?: string
          movimiento_id?: string
          precio_unitario?: number | null
          product_id?: string
          promo_id?: string | null
          subtotal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimiento_items_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_items_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promos"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos: {
        Row: {
          canal: string | null
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          notas: string | null
          nro_remito: string | null
          pago_billetera: number | null
          pago_efectivo: number | null
          pago_tarjeta: number | null
          pago_transferencia: number | null
          personal_id: string | null
          proveedor: string | null
          remito_image_url: string | null
          sucursal_id: string
          tipo: string
        }
        Insert: {
          canal?: string | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          nro_remito?: string | null
          pago_billetera?: number | null
          pago_efectivo?: number | null
          pago_tarjeta?: number | null
          pago_transferencia?: number | null
          personal_id?: string | null
          proveedor?: string | null
          remito_image_url?: string | null
          sucursal_id: string
          tipo?: string
        }
        Update: {
          canal?: string | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          nro_remito?: string | null
          pago_billetera?: number | null
          pago_efectivo?: number | null
          pago_tarjeta?: number | null
          pago_transferencia?: number | null
          personal_id?: string | null
          proveedor?: string | null
          remito_image_url?: string | null
          sucursal_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_personal_id_fkey"
            columns: ["personal_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          bank_alias: string
          bank_cbu: string
          bank_holder: string
          cuit_emisor: string
          id: number
          ideaia_commission_rate: number
          updated_at: string
          whatsapp_phone_display: string | null
        }
        Insert: {
          bank_alias?: string
          bank_cbu?: string
          bank_holder?: string
          cuit_emisor?: string
          id?: number
          ideaia_commission_rate?: number
          updated_at?: string
          whatsapp_phone_display?: string | null
        }
        Update: {
          bank_alias?: string
          bank_cbu?: string
          bank_holder?: string
          cuit_emisor?: string
          id?: number
          ideaia_commission_rate?: number
          updated_at?: string
          whatsapp_phone_display?: string | null
        }
        Relationships: []
      }
      product_price_history: {
        Row: {
          changed_at: string
          costo_anterior: number | null
          costo_nuevo: number | null
          id: string
          precio_dist_anterior: number | null
          precio_dist_nuevo: number | null
          product_id: string
        }
        Insert: {
          changed_at?: string
          costo_anterior?: number | null
          costo_nuevo?: number | null
          id?: string
          precio_dist_anterior?: number | null
          precio_dist_nuevo?: number | null
          product_id: string
        }
        Update: {
          changed_at?: string
          costo_anterior?: number | null
          costo_nuevo?: number | null
          id?: string
          precio_dist_anterior?: number | null
          precio_dist_nuevo?: number | null
          product_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          bolsas_caja: number | null
          category_id: string | null
          costo: number | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          freezer_required: boolean
          gallery_urls: Json
          id: string
          is_active: boolean
          kg_caja: number | null
          margen_dist: number | null
          margen_gastro: number | null
          margen_min: number | null
          metadata: Json
          min_quantity_b2b: number
          mult_bolsas: boolean | null
          name: string
          pkg_bulto: number | null
          pkg_unitario: number | null
          precio_dist: number | null
          precio_gastro: number | null
          precio_min: number | null
          price_b2b: number
          price_b2c: number
          short_description: string | null
          sku: string
          slug: string
          stock_minimo: number
          unit_label: string
          updated_at: string
          weight_grams: number | null
        }
        Insert: {
          bolsas_caja?: number | null
          category_id?: string | null
          costo?: number | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          freezer_required?: boolean
          gallery_urls?: Json
          id?: string
          is_active?: boolean
          kg_caja?: number | null
          margen_dist?: number | null
          margen_gastro?: number | null
          margen_min?: number | null
          metadata?: Json
          min_quantity_b2b?: number
          mult_bolsas?: boolean | null
          name: string
          pkg_bulto?: number | null
          pkg_unitario?: number | null
          precio_dist?: number | null
          precio_gastro?: number | null
          precio_min?: number | null
          price_b2b?: number
          price_b2c?: number
          short_description?: string | null
          sku: string
          slug: string
          stock_minimo?: number
          unit_label?: string
          updated_at?: string
          weight_grams?: number | null
        }
        Update: {
          bolsas_caja?: number | null
          category_id?: string | null
          costo?: number | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          freezer_required?: boolean
          gallery_urls?: Json
          id?: string
          is_active?: boolean
          kg_caja?: number | null
          margen_dist?: number | null
          margen_gastro?: number | null
          margen_min?: number | null
          metadata?: Json
          min_quantity_b2b?: number
          mult_bolsas?: boolean | null
          name?: string
          pkg_bulto?: number | null
          pkg_unitario?: number | null
          precio_dist?: number | null
          precio_gastro?: number | null
          precio_min?: number | null
          price_b2b?: number
          price_b2c?: number
          short_description?: string | null
          sku?: string
          slug?: string
          stock_minimo?: number
          unit_label?: string
          updated_at?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          b2b_status: string | null
          canal: string | null
          created_at: string
          credito_limite: number | null
          document_number: string | null
          document_type: string | null
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          sucursal_id: string | null
          updated_at: string
          zona_id: string | null
        }
        Insert: {
          b2b_status?: string | null
          canal?: string | null
          created_at?: string
          credito_limite?: number | null
          document_number?: string | null
          document_type?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sucursal_id?: string | null
          updated_at?: string
          zona_id?: string | null
        }
        Update: {
          b2b_status?: string | null
          canal?: string | null
          created_at?: string
          credito_limite?: number | null
          document_number?: string | null
          document_type?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sucursal_id?: string | null
          updated_at?: string
          zona_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_items: {
        Row: {
          cantidad: number
          created_at: string
          id: string
          product_id: string
          promo_id: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          id?: string
          product_id: string
          promo_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          id?: string
          product_id?: string
          promo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_items_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promos"
            referencedColumns: ["id"]
          },
        ]
      }
      promos: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      proveedores: {
        Row: {
          contacto: string | null
          created_at: string
          id: string
          is_active: boolean
          nombre: string
        }
        Insert: {
          contacto?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          nombre: string
        }
        Update: {
          contacto?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          nombre?: string
        }
        Relationships: []
      }
      retiros_caja: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          id: string
          monto: number
          motivo: string
          sucursal_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto: number
          motivo: string
          sucursal_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          id?: string
          monto?: number
          motivo?: string
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retiros_caja_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursales: {
        Row: {
          created_at: string
          direccion: string | null
          encargado_email: string | null
          encargado_nombre: string | null
          encargado_telefono: string | null
          encargado_user_id: string | null
          id: string
          is_active: boolean
          localidad: string
          nombre: string
          notas: string | null
          provincia: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          encargado_email?: string | null
          encargado_nombre?: string | null
          encargado_telefono?: string | null
          encargado_user_id?: string | null
          id?: string
          is_active?: boolean
          localidad?: string
          nombre: string
          notas?: string | null
          provincia?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          direccion?: string | null
          encargado_email?: string | null
          encargado_nombre?: string | null
          encargado_telefono?: string | null
          encargado_user_id?: string | null
          id?: string
          is_active?: boolean
          localidad?: string
          nombre?: string
          notas?: string | null
          provincia?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      stock_sucursal: {
        Row: {
          entradas: number | null
          product_id: string | null
          product_name: string | null
          salidas: number | null
          sku: string | null
          stock_actual: number | null
          sucursal_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimiento_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      crear_movimiento_con_items: {
        Args: {
          p_canal?: string
          p_created_by?: string
          p_fecha: string
          p_items?: Json
          p_notas?: string
          p_nro_remito?: string
          p_pago_billetera?: number
          p_pago_efectivo?: number
          p_pago_tarjeta?: number
          p_pago_transferencia?: number
          p_personal_id?: string
          p_proveedor?: string
          p_sucursal_id: string
          p_tipo: string
        }
        Returns: string
      }
      current_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      b2b_status: "pending" | "approved" | "rejected" | "suspended"
      order_channel: "b2c_nacional" | "b2b_mayorista" | "pedido_ya_local"
      order_status:
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
        | "en_distribucion"
      user_role:
        | "customer_b2c"
        | "customer_b2b"
        | "repartidor"
        | "admin_enminutas"
        | "admin_ideaia"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      b2b_status: ["pending", "approved", "rejected", "suspended"],
      order_channel: ["b2c_nacional", "b2b_mayorista", "pedido_ya_local"],
      order_status: [
        "pending_payment",
        "payment_review",
        "paid",
        "preparing",
        "ready",
        "in_delivery",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
        "aprobado",
        "enviado_prod",
        "despachado",
        "en_distribucion",
      ],
      user_role: [
        "customer_b2c",
        "customer_b2b",
        "repartidor",
        "admin_enminutas",
        "admin_ideaia",
      ],
    },
  },
} as const
