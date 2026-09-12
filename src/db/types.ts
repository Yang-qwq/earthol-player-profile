/** Row shapes returned by D1, matching `schema.sql` column-for-column. */
export interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
  is_admin: number;
  created_at: number;
  updated_at: number;
}

export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: number;
}

export interface FieldRow {
  id: string;
  user_id: string;
  label: string;
  value: string;
  sort_order: number;
  created_at: number;
}

export interface TagCategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface UserTagRow {
  id: string;
  user_id: string;
  category_id: string;
  value: string;
  hidden: number;
  sort_order: number;
  created_at: number;
  category_name: string;
  category_color: string;
}

export interface LoginTokenRow {
  token_hash: string;
  email: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface ProfileInput {
  username: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
}

export interface FieldInput {
  label: string;
  value: string;
}

export interface TagInput {
  categoryId: string;
  value: string;
  hidden: boolean;
}
