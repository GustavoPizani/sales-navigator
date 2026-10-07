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
          lead_id: string | null
          owner_id: string
          project_id: string | null
          reminder_sent_minutes: number[]
          start_time: string
          title: string
          type: Database["public"]["Enums"]["appointment_type"]
          visit_status: string | null
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
          lead_id?: string | null
          owner_id: string
          project_id?: string | null
          reminder_sent_minutes?: number[]
          start_time: string
          title: string
          type?: Database["public"]["Enums"]["appointment_type"]
          visit_status?: string | null
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
          lead_id?: string | null
          owner_id?: string
          project_id?: string | null
          reminder_sent_minutes?: number[]
          start_time?: string
          title?: string
          type?: Database["public"]["Enums"]["appointment_type"]
          visit_status?: string | null
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
      atendimentos: {
        Row: {
          appointment_id: string | null
          broker_id: string
          created_at: string | null
          data: string
          data_atualizacao: string | null
          email: string | null
          id: string
          id_cliente: string | null
          nome_cliente: string
          ocorrencia: string | null
          produto: string | null
          setor: string | null
          status: string | null
          telefone: string | null
          temperatura: string | null
          valor: number | null
          venda: boolean | null
          visita: boolean | null
        }
        Insert: {
          appointment_id?: string | null
          broker_id: string
          created_at?: string | null
          data: string
          data_atualizacao?: string | null
          email?: string | null
          id?: string
          id_cliente?: string | null
          nome_cliente: string
          ocorrencia?: string | null
          produto?: string | null
          setor?: string | null
          status?: string | null
          telefone?: string | null
          temperatura?: string | null
          valor?: number | null
          venda?: boolean | null
          visita?: boolean | null
        }
        Update: {
          appointment_id?: string | null
          broker_id?: string
          created_at?: string | null
          data?: string
          data_atualizacao?: string | null
          email?: string | null
          id?: string
          id_cliente?: string | null
          nome_cliente?: string
          ocorrencia?: string | null
          produto?: string | null
          setor?: string | null
          status?: string | null
          telefone?: string | null
          temperatura?: string | null
          valor?: number | null
          venda?: boolean | null
          visita?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "atendimentos_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atendimentos_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cargo_permissions: {
        Row: {
          cargo_id: string
          level: string
          module: string
        }
        Insert: {
          cargo_id: string
          level: string
          module: string
        }
        Update: {
          cargo_id?: string
          level?: string
          module?: string
        }
        Relationships: [
          {
            foreignKeyName: "cargo_permissions_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "cargos"
            referencedColumns: ["id"]
          },
        ]
      }
      cargos: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
        }
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
        }
        Relationships: []
      }
      checkin_log: {
        Row: {
          accuracy_m: number | null
          adjusts_id: string | null
          checkin_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          distance_m: number | null
          end_time: string
          event: string
          event_override: string | null
          id: string
          justification: string | null
          lat: number | null
          lng: number | null
          location: string | null
          location_label: string | null
          occurred_at: string
          replaced_names: string | null
          shift_id: string | null
          slot_team_name: string | null
          start_time: string
          team_manager_id: string | null
          team_name: string | null
          turn_date: string
          user_id: string
          user_name: string
        }
        Insert: {
          accuracy_m?: number | null
          adjusts_id?: string | null
          checkin_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          distance_m?: number | null
          end_time: string
          event: string
          event_override?: string | null
          id?: string
          justification?: string | null
          lat?: number | null
          lng?: number | null
          location?: string | null
          location_label?: string | null
          occurred_at?: string
          replaced_names?: string | null
          shift_id?: string | null
          slot_team_name?: string | null
          start_time: string
          team_manager_id?: string | null
          team_name?: string | null
          turn_date: string
          user_id: string
          user_name: string
        }
        Update: {
          accuracy_m?: number | null
          adjusts_id?: string | null
          checkin_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          distance_m?: number | null
          end_time?: string
          event?: string
          event_override?: string | null
          id?: string
          justification?: string | null
          lat?: number | null
          lng?: number | null
          location?: string | null
          location_label?: string | null
          occurred_at?: string
          replaced_names?: string | null
          shift_id?: string | null
          slot_team_name?: string | null
          start_time?: string
          team_manager_id?: string | null
          team_name?: string | null
          turn_date?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      funnel_stages: {
        Row: {
          color: string
          created_at: string
          funnel_id: string
          id: string
          kind: string | null
          name: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          funnel_id: string
          id?: string
          kind?: string | null
          name: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          funnel_id?: string
          id?: string
          kind?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      lead_notes: {
        Row: {
          author_id: string | null
          content: string
          created_at: string
          id: string
          kind: string
          lead_id: string
        }
        Insert: {
          author_id?: string | null
          content: string
          created_at?: string
          id?: string
          kind?: string
          lead_id: string
        }
        Update: {
          author_id?: string | null
          content?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          broker_id: string
          campaign: string | null
          client_code: string | null
          created_at: string
          created_by: string | null
          email: string | null
          external_id: string | null
          form_responses: Json | null
          full_name: string
          funnel_id: string
          id: string
          lost_at: string | null
          lost_reason: string | null
          phone: string | null
          project_id: string | null
          roulette_id: string | null
          source: string
          stage_changed_at: string
          stage_id: string
          status: Database["public"]["Enums"]["lead_status"]
          temperatura: string | null
          updated_at: string
          won_at: string | null
          won_value: number | null
        }
        Insert: {
          broker_id: string
          campaign?: string | null
          client_code?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          form_responses?: Json | null
          full_name: string
          funnel_id: string
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          phone?: string | null
          project_id?: string | null
          roulette_id?: string | null
          source?: string
          stage_changed_at?: string
          stage_id: string
          status?: Database["public"]["Enums"]["lead_status"]
          temperatura?: string | null
          updated_at?: string
          won_at?: string | null
          won_value?: number | null
        }
        Update: {
          broker_id?: string
          campaign?: string | null
          client_code?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          form_responses?: Json | null
          full_name?: string
          funnel_id?: string
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          phone?: string | null
          project_id?: string | null
          roulette_id?: string | null
          source?: string
          stage_changed_at?: string
          stage_id?: string
          status?: Database["public"]["Enums"]["lead_status"]
          temperatura?: string | null
          updated_at?: string
          won_at?: string | null
          won_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "funnel_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit: {
        Row: {
          cargo_id: string | null
          cargo_name: string | null
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          module: string
          new_level: string | null
          old_level: string | null
        }
        Insert: {
          cargo_id?: string | null
          cargo_name?: string | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          module: string
          new_level?: string | null
          old_level?: string | null
        }
        Update: {
          cargo_id?: string | null
          cargo_name?: string | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          module?: string
          new_level?: string | null
          old_level?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cargo_id: string | null
          color: string
          created_at: string
          email: string
          enabled_features: Json
          full_name: string
          id: string
          is_active: boolean
          is_test: boolean
          manager_id: string | null
          phone: string | null
          reminder_minutes: number[]
          role: Database["public"]["Enums"]["app_role"]
          shift_reminder_time: string | null
          team_name: string | null
          setor: string | null
        }
        Insert: {
          avatar_url?: string | null
          cargo_id?: string | null
          color?: string
          created_at?: string
          email: string
          enabled_features?: Json
          full_name?: string
          id: string
          is_active?: boolean
          is_test?: boolean
          manager_id?: string | null
          phone?: string | null
          reminder_minutes?: number[]
          role?: Database["public"]["Enums"]["app_role"]
          shift_reminder_time?: string | null
          team_name?: string | null
          setor?: string | null
        }
        Update: {
          avatar_url?: string | null
          cargo_id?: string | null
          color?: string
          created_at?: string
          email?: string
          enabled_features?: Json
          full_name?: string
          id?: string
          is_active?: boolean
          is_test?: boolean
          manager_id?: string | null
          phone?: string | null
          reminder_minutes?: number[]
          role?: Database["public"]["Enums"]["app_role"]
          shift_reminder_time?: string | null
          team_name?: string | null
          setor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          latitude: number | null
          longitude: number | null
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
          latitude?: number | null
          longitude?: number | null
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
          latitude?: number | null
          longitude?: number | null
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roulette_settings: {
        Row: {
          central_address: string | null
          central_lat: number | null
          central_lng: number | null
          central_radius_m: number
          checkin_open_before_min: number
          checkin_reminder_min: number
          id: number
          max_accuracy_m: number
          plantao_address: string | null
          plantao_lat: number | null
          plantao_lng: number | null
          plantao_project_id: string | null
          plantao_radius_m: number
          tolerance_min: number
          manha_end: string
          manha_require_gps: boolean
          manha_start: string
          noite_require_gps: boolean
          tarde_require_gps: boolean
          noite_end: string
          noite_start: string
          tarde_end: string
          tarde_start: string
          updated_at: string
        }
        Insert: {
          central_address?: string | null
          central_lat?: number | null
          central_lng?: number | null
          central_radius_m?: number
          checkin_open_before_min?: number
          checkin_reminder_min?: number
          id?: number
          max_accuracy_m?: number
          plantao_address?: string | null
          plantao_lat?: number | null
          plantao_lng?: number | null
          plantao_project_id?: string | null
          plantao_radius_m?: number
          tolerance_min?: number
          manha_end?: string
          manha_require_gps?: boolean
          manha_start?: string
          noite_require_gps?: boolean
          tarde_require_gps?: boolean
          noite_end?: string
          noite_start?: string
          tarde_end?: string
          tarde_start?: string
          updated_at?: string
        }
        Update: {
          central_address?: string | null
          central_lat?: number | null
          central_lng?: number | null
          central_radius_m?: number
          checkin_open_before_min?: number
          checkin_reminder_min?: number
          id?: number
          max_accuracy_m?: number
          plantao_address?: string | null
          plantao_lat?: number | null
          plantao_lng?: number | null
          plantao_project_id?: string | null
          plantao_radius_m?: number
          tolerance_min?: number
          manha_end?: string
          manha_require_gps?: boolean
          manha_start?: string
          noite_require_gps?: boolean
          tarde_require_gps?: boolean
          noite_end?: string
          noite_start?: string
          tarde_end?: string
          tarde_start?: string
          updated_at?: string
        }
        Relationships: []
      }
      roulette_checkins: {
        Row: {
          accuracy_m: number | null
          broker_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          distance_m: number | null
          end_time: string
          id: string
          kind: string
          lat: number | null
          lng: number | null
          location: string
          shift_id: string | null
          slot_id: string | null
          start_time: string
          status: string
          team_manager_id: string | null
          turn_date: string
        }
        Insert: {
          accuracy_m?: number | null
          broker_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          distance_m?: number | null
          end_time: string
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          location: string
          shift_id?: string | null
          slot_id?: string | null
          start_time: string
          status: string
          team_manager_id?: string | null
          turn_date: string
        }
        Update: {
          accuracy_m?: number | null
          broker_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          distance_m?: number | null
          end_time?: string
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          location?: string
          shift_id?: string | null
          slot_id?: string | null
          start_time?: string
          status?: string
          team_manager_id?: string | null
          turn_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "roulette_checkins_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roulette_turns: {
        Row: {
          end_time: string
          needs_admin: boolean
          open_count: number | null
          processed_at: string | null
          standby_count: number | null
          start_time: string
          turn_date: string
        }
        Insert: {
          end_time: string
          needs_admin?: boolean
          open_count?: number | null
          processed_at?: string | null
          standby_count?: number | null
          start_time: string
          turn_date: string
        }
        Update: {
          end_time?: string
          needs_admin?: boolean
          open_count?: number | null
          processed_at?: string | null
          standby_count?: number | null
          start_time?: string
          turn_date?: string
        }
        Relationships: []
      }
      shift_configs: {
        Row: {
          created_at: string | null
          id: string
          link_token: string
          manager_id: string | null
          modality: string | null
          project_id: string | null
          week_start_date: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          link_token: string
          manager_id?: string | null
          modality?: string | null
          project_id?: string | null
          week_start_date: string
        }
        Update: {
          created_at?: string | null
          id?: string
          link_token?: string
          manager_id?: string | null
          modality?: string | null
          project_id?: string | null
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_configs_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_slots: {
        Row: {
          capacity: number
          config_id: string | null
          date: string
          end_time: string
          id: string
          period: string | null
          start_time: string
        }
        Insert: {
          capacity: number
          config_id?: string | null
          date: string
          end_time: string
          id?: string
          period?: string | null
          start_time: string
        }
        Update: {
          capacity?: number
          config_id?: string | null
          date?: string
          end_time?: string
          id?: string
          period?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_slots_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "shift_configs"
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
          missed_at: string | null
          notes: string | null
          reminder_sent_at: string | null
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
          missed_at?: string | null
          notes?: string | null
          reminder_sent_at?: string | null
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
          missed_at?: string | null
          notes?: string | null
          reminder_sent_at?: string | null
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
          {
            foreignKeyName: "shifts_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "shift_slots"
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
      vendas: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          atendimento_id: string
          broker_id: string
          created_at: string | null
          data_venda: string
          id: string
          produto: string | null
          rejected_reason: string | null
          status: string
          unidade: string | null
          valor: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          atendimento_id: string
          broker_id: string
          created_at?: string | null
          data_venda: string
          id?: string
          produto?: string | null
          rejected_reason?: string | null
          status?: string
          unidade?: string | null
          valor?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          atendimento_id?: string
          broker_id?: string
          created_at?: string | null
          data_venda?: string
          id?: string
          produto?: string | null
          rejected_reason?: string | null
          status?: string
          unidade?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendas_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          },
        ]
      }
      visitas: {
        Row: {
          appointment_id: string | null
          atendimento_id: string | null
          broker_id: string
          created_at: string
          data_visita: string
          id: string
          id_cliente: string | null
          lead_id: string | null
          nome_cliente: string | null
          produto: string | null
        }
        Insert: {
          appointment_id?: string | null
          atendimento_id?: string | null
          broker_id: string
          created_at?: string
          data_visita?: string
          id?: string
          id_cliente?: string | null
          lead_id?: string | null
          nome_cliente?: string | null
          produto?: string | null
        }
        Update: {
          appointment_id?: string | null
          atendimento_id?: string | null
          broker_id?: string
          created_at?: string
          data_visita?: string
          id?: string
          id_cliente?: string | null
          lead_id?: string | null
          nome_cliente?: string | null
          produto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitas_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_atendimento_id_fkey"
            columns: ["atendimento_id"]
            isOneToOne: false
            referencedRelation: "atendimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_broker_id_fkey"
            columns: ["broker_id"]
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
      admin_reset_password: {
        Args: { p_new_password: string; p_user_id: string }
        Returns: boolean
      }
      claim_shift_slot: {
        Args: { p_broker_id: string; p_slot_id: string }
        Returns: undefined
      }
      get_shift_config_by_token: { Args: { p_token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      crm_can_access_broker: { Args: { _broker_id: string }; Returns: boolean }
      crm_checkin_log_adjust: {
        Args: {
          p_log_id: string
          p_justification: string
          p_event_override?: string
          p_occurred_at?: string
        }
        Returns: string
      }
      crm_can: { Args: { _module: string; _min: string }; Returns: boolean }
      crm_set_team_quota: {
        Args: { p_manager_id: string; p_week_start: string; p_quota: Json }
        Returns: Json
      }
      crm_roulette_checkin: {
        Args: { p_lat: number | null; p_lng: number | null; p_accuracy: number | null }
        Returns: Json
      }
      crm_roulette_admin_decide: {
        Args: { p_checkin_id: string; p_slot_id: string | null }
        Returns: undefined
      }
      crm_slot_open: { Args: { _slot_id: string }; Returns: number }
      crm_setup_member: {
        Args: {
          p_user_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_manager_id?: string
          p_team_name?: string
        }
        Returns: undefined
      }
      is_manager: { Args: { _user_id: string }; Returns: boolean }
      crm_mark_visit_not_done: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      crm_mark_visit_done: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      crm_is_global: { Args: { _user_id: string }; Returns: boolean }
      crm_is_subordinate: {
        Args: { _manager_id: string; _subordinate_id: string }
        Returns: boolean
      }
      is_director: { Args: { _user_id: string }; Returns: boolean }
      my_manager_id: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "broker" | "director" | "master" | "hr"
      appointment_type: "visit" | "meeting" | "call" | "follow-up"
      lead_status: "active" | "won" | "lost"
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
      app_role: ["admin", "broker", "director", "master", "hr"],
      appointment_type: ["visit", "meeting", "call", "follow-up"],
      lead_status: ["active", "won", "lost"],
      task_priority: ["high", "medium", "low"],
    },
  },
} as const
