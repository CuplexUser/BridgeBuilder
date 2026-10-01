import type { LevelResource } from './types';

export const FORMAT: number;
export const RESOURCE_FILE: string;
export function readResource(file?: string): LevelResource;
export function writeResource(data: LevelResource, file?: string): void;
export function designsOf(data: LevelResource): Record<string, { reference: string; bonus: string | null }>;
export function resourceModule(data: LevelResource): string;
