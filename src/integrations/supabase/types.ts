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
      atendimentos: {
        Row: {
          id: string
          created_at: string
          broker_id: string
          appointment_id: string | null
          data: string
          data_atualizacao: string | null
          nome_cliente: string | null
          id_cliente: string | null
          telefone: string | null
          email: string | null
          produto: string | null
          setor: string | null
          ocorrencia: string | null
          temperatura: string | null
          visita: boolean
          venda: boolean
          status: string | null
          valor: number | null
        }
        Insert: {
          id?: string
          created_at?: string
          broker_id: string
          appointment_id?: string | null
          data: string
          data_atualizacao?: string | null
          nome_cliente?: string | null
          id_cliente?: string | null
          telefone?: string | null
          email?: string | null
          produto?: string | null
          setor?: string | null
          ocorrencia?: string | null
          temperatura?: string | null
          visita?: boolean
          venda?: boolean
          status?: string | null
          valor?: number | null
        }
        Update: {
          id?: string
          created_at?: string
          broker_id?: string
          appointment_id?: string | null
          data?: string
          data_atualizacao?: string | null
          nome_cliente?: string | null
          id_cliente?: string | null
          telefone?: string | null
          email?: string | null
          produto?: string | null
          setor?: string | null
          ocorrencia?: string | null
          temperatura?: string | null
          visita?: boolean
          venda?: boolean
          status?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "atendimentos_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      vendas: {
        Row: {
          id: string
          created_at: string
          atendimento_id: string
          broker_id: string
          data_venda: string
          produto: string | null
          unidade: string | null
          valor: number | null
          status: string
          approved_by: string | null
          approved_at: string | null
          rejected_reason: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          atendimento_id: string
          broker_id: string
          data_venda: string
          produto?: string | null
          unidade?: string | null
          valor?: number | null
          status?: string
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          atendimento_id?: string
          broker_id?: string
          data_venda?: string
          produto?: string | null
          unidade?: string | null
          valor?: number | null
          status?: string
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendas_atendimento_id_fkey"
            columns: ["atendimento_id"]
            isOneToOne: false
            referencedRelation: "atendimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      appointments: {
        Row: {
          client_email: string | null
          client_id: string | null
          client_name: string | null
          created_at: string
          custom_location: string | null
          date: string
          description: string | null
          end_time: string
          google_calendar_link: string | null
          id: string
          include_manager: boolean
          owner_id: string
          project_id: string | null
          start_time: string
          title: string
          type: Database["public"]["Enums"]["appointment_type"]
        }
        Insert: {
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          custom_location?: string | null
          date: string
          description?: string | null
          end_time: string
          google_calendar_link?: string | null
          id?: string
          include_manager?: boolean
          owner_id: string
          project_id?: string | null
          start_time: string
          title: string
          type?: Database["public"]["Enums"]["appointment_type"]
        }
        Update: {
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          custom_location?: string | null
          date?: string
          description?: string | null
          end_time?: string
          google_calendar_link?: string | null
          id?: string
          include_manager?: boolean
          owner_id?: string
          project_id?: string | null
          start_time?: string
          title?: string
          type?: Database["public"]["Enums"]["appointment_type"]
        }
        Relationships: [
          {
            foreignKeyName: "appointments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_configs: {
        Row: {
          id: string
          created_at: string
          manager_id: string
          week_start_date: string
          modality: string
          project_id: string | null
          link_token: string
        }
        Insert: {
          id?: string
          created_at?: string
          manager_id: string
          week_start_date: string
          modality?: string
          project_id?: string | null
          link_token: string
        }
        Update: {
          id?: string
          created_at?: string
          manager_id?: string
          week_start_date?: string
          modality?: string
          project_id?: string | null
          link_token?: string
        }
        Relationships: []
      }
      shift_slots: {
        Row: {
          id: string
          created_at: string
          config_id: string
          date: string
          period: string
          capacity: number
          start_time: string
          end_time: string
        }
        Insert: {
          id?: string
          created_at?: string
          config_id: string
          date: string
          period: string
          capacity?: number
          start_time: string
          end_time: string
        }
        Update: {
          id?: string
          created_at?: string
          config_id?: string
          date?: string
          period?: string
          capacity?: number
          start_time?: string
          end_time?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          color: string
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          manager_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          color?: string
          created_at?: string
          email: string
          full_name?: string
          id: string
          is_active?: boolean
          manager_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          color?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      projects: {
        Row: {
          address: string
          city: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          manager_id: string
          name: string
          tem_plantao: boolean | null
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          manager_id: string
          name: string
          tem_plantao?: boolean | null
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          manager_id?: string
          name?: string
          tem_plantao?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          broker_id: string
          created_at: string
          date: string
          end_time: string
          id: string
          manager_id: string
          notes: string | null
          slot_id: string | null
          start_time: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          manager_id: string
          notes?: string | null
          slot_id?: string | null
          start_time: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          manager_id?: string
          notes?: string | null
          slot_id?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          created_at: string
          due_date: string
          due_time: string | null
          id: string
          is_done: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_date?: string
          due_time?: string | null
          id?: string
          is_done?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          due_time?: string | null
          id?: string
          is_done?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "broker" | "director" | "master"
      appointment_type: "visit" | "meeting" | "call" | "follow-up"
      task_priority: "high" | "medium" | "low"
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
      app_role: ["admin", "broker", "director", "master"],
      appointment_type: ["visit", "meeting", "call", "follow-up"],
      task_priority: ["high", "medium", "low"],
    },
  },
} as const
