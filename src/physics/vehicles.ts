export type VehicleId = 'car' | 'van' | 'truck' | 'bus' | 'semi' | 'loco' | 'wagon' | 'troop';

export interface VehicleDef {
  id: VehicleId;
  name: string;
  mass: number;
  /** Weight as players read it, checked against a deck's rating. */
  tonnes: number;
  wheelbase: number;
  /** Extra axles between the rear and front wheels, as distances from the rear wheel. */
  midAxles?: number[];
  wheelR: number;
  /** Height of the body above the wheel centers. */
  height: number;
  /** Cruise speed, m/s. */
  speed: number;
  /** Traction acceleration limit, m/s². */
  accel: number;
  color: string;
  trim: string;
  /** Rolls on railway track only, and couples to the rail vehicle ahead in a train. */
  rail?: boolean;
  /** Soldiers marching in step: on a level with a march, each footfall lands on the deck together. */
  marches?: boolean;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  car: { id: 'car', name: 'Compact car', mass: 900, tonnes: 9, wheelbase: 2.1, wheelR: 0.36, height: 0.9, speed: 5.5, accel: 7, color: '#e8483b', trim: '#ffd5a8' },
  van: { id: 'van', name: 'Delivery van', mass: 1500, tonnes: 15, wheelbase: 2.5, wheelR: 0.42, height: 1.3, speed: 5, accel: 6.5, color: '#f4f1e6', trim: '#3a7bd5' },
  truck: { id: 'truck', name: 'Dump truck', mass: 2200, tonnes: 22, wheelbase: 3.0, wheelR: 0.5, height: 1.5, speed: 4.5, accel: 6, color: '#f29f1f', trim: '#5b4a3a' },
  semi: { id: 'semi', name: 'Semi truck', mass: 4000, tonnes: 40, wheelbase: 4.6, midAxles: [2.3], wheelR: 0.52, height: 1.9, speed: 4, accel: 5, color: '#3a6fd8', trim: '#d8dde6' },
  // A train is a locomotive with wagons behind it: see LevelDef.convoy. Each rides on four axles.
  loco: { id: 'loco', name: 'Locomotive', mass: 3600, tonnes: 36, wheelbase: 5, midAxles: [1.2, 3.8], wheelR: 0.42, height: 2.3, speed: 4, accel: 2.5, color: '#c8432f', trim: '#2b2f36', rail: true },
  wagon: { id: 'wagon', name: 'Freight wagon', mass: 2800, tonnes: 28, wheelbase: 5.4, midAxles: [1.2, 4.2], wheelR: 0.4, height: 2, speed: 4, accel: 2.5, color: '#3f6b52', trim: '#d6ccb8', rail: true },
  // A squad of soldiers, two abreast and five deep: a light load, but every boot lands at once.
  troop: { id: 'troop', name: 'Marching squad', mass: 800, tonnes: 8, wheelbase: 3.2, wheelR: 0.3, height: 1.5, speed: 1.6, accel: 3, color: '#5a6b3c', trim: '#c9b98a', marches: true },
  bus: { id: 'bus', name: 'School bus', mass: 3000, tonnes: 30, wheelbase: 3.8, wheelR: 0.5, height: 1.8, speed: 4.2, accel: 5.5, color: '#f7c832', trim: '#2b2b2b' },
};
