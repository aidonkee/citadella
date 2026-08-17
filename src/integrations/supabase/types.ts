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
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      chat_members: {
        Row: {
          added_at: string
          chat_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          chat_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          chat_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          dm_user_id: string | null
          id: string
          is_dm: boolean
          name: string
        }
        Insert: {
          created_at?: string
          dm_user_id?: string | null
          id?: string
          is_dm?: boolean
          name: string
        }
        Update: {
          created_at?: string
          dm_user_id?: string | null
          id?: string
          is_dm?: boolean
          name?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          is_ai: boolean
          kind: string
          metadata: Json
          order_id: string | null
          sender_user_id: string | null
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          is_ai?: boolean
          kind?: string
          metadata?: Json
          order_id?: string | null
          sender_user_id?: string | null
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          is_ai?: boolean
          kind?: string
          metadata?: Json
          order_id?: string | null
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          email_address: string | null
          email_new_claims: boolean
          email_status_changes: boolean
          email_worker_replies: boolean
          realtime_new_claims: boolean
          realtime_status_changes: boolean
          realtime_worker_replies: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_address?: string | null
          email_new_claims?: boolean
          email_status_changes?: boolean
          email_worker_replies?: boolean
          realtime_new_claims?: boolean
          realtime_status_changes?: boolean
          realtime_worker_replies?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_address?: string | null
          email_new_claims?: boolean
          email_status_changes?: boolean
          email_worker_replies?: boolean
          realtime_new_claims?: boolean
          realtime_status_changes?: boolean
          realtime_worker_replies?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_assignments: {
        Row: {
          chat_id: string
          completed_at: string | null
          created_at: string
          id: string
          order_id: string
          order_index: number | null
          responsible_user_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          chat_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          order_id: string
          order_index?: number | null
          responsible_user_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          chat_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          order_id?: string
          order_index?: number | null
          responsible_user_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_assignments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_claims: {
        Row: {
          chat_id: string
          claimed_at: string
          id: string
          order_id: string
          status: string
          user_id: string
        }
        Insert: {
          chat_id: string
          claimed_at?: string
          id?: string
          order_id: string
          status?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          claimed_at?: string
          id?: string
          order_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_claims_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_claims_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          ai_message_id: string | null
          barcode: string | null
          chat_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          customer_order: string | null
          delivery_address: string | null
          dispatched_at: string | null
          dispatched_chat_ids: string[]
          finish_date: string | null
          follow_up_interval_minutes: number
          id: string
          is_dispatched: boolean
          last_update_at: string | null
          next_follow_up_at: string | null
          nomenclature: string
          number: string
          order_date: string | null
          priority: string
          responsible_user_id: string | null
          stage: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          ai_message_id?: string | null
          barcode?: string | null
          chat_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          customer_order?: string | null
          delivery_address?: string | null
          dispatched_at?: string | null
          dispatched_chat_ids?: string[]
          finish_date?: string | null
          follow_up_interval_minutes?: number
          id?: string
          is_dispatched?: boolean
          last_update_at?: string | null
          next_follow_up_at?: string | null
          nomenclature?: string
          number: string
          order_date?: string | null
          priority?: string
          responsible_user_id?: string | null
          stage?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          ai_message_id?: string | null
          barcode?: string | null
          chat_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          customer_order?: string | null
          delivery_address?: string | null
          dispatched_at?: string | null
          dispatched_chat_ids?: string[]
          finish_date?: string | null
          follow_up_interval_minutes?: number
          id?: string
          is_dispatched?: boolean
          last_update_at?: string | null
          next_follow_up_at?: string | null
          nomenclature?: string
          number?: string
          order_date?: string | null
          priority?: string
          responsible_user_id?: string | null
          stage?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          username?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_chat_member: {
        Args: { _chat_id: string; _user_id: string }
        Returns: boolean
      }
      is_manager: { Args: { _user_id: string }; Returns: boolean }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "worker" | "manager"
      order_status: "new" | "distributed" | "in_progress" | "stalled" | "blocked" | "completed" | "overdue" | "cancelled"
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
      app_role: ["owner", "worker", "manager"],
      order_status: ["new", "in_progress", "stalled", "completed", "overdue"],
    },
  },
} as const
