// Shared types between client and server

export interface Recipe {
  id: number | string
  title: string
  ingredients: string[]
  ner?: string[]
  directions?: string
  link?: string
  source?: string
  site?: string
  score?: number
  likesCount?: number
}

export interface User {
  id: string
  email: string
  name: string
  likes?: (number | string)[]
}

export interface IngredientsResponse {
  ingredients: string[]
  error?: string
}

export interface RecipesRequest {
  userId?: string
  ingredients: string[]
  limit?: number
}

export interface RecipesResponse {
  recipes: Recipe[]
  note?: string
  error?: string
}

export interface LikeRequest {
  userId: string
  recipeId: number | string
}

export interface LikeResponse { ok: boolean }

export interface LoginRequest { email: string; password: string }
export interface LoginResponse { user: User }

export interface SignupRequest { email: string; name: string; password: string }
export interface SignupResponse { user: User }
