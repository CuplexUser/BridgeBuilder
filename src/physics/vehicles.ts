export type VehicleId = 'car' | 'van' | 'truck' | 'bus' | 'semi';

export interface VehicleDef {
  id: VehicleId;
  name: string;
  mass: number;
  wheelbase: number;
  wheelR: number;
  /** Height of the body above the wheel centers. */
  height: number;
  /** Cruise speed, m/s. */
  speed: number;
  /** Traction acceleration limit, m/s². */
  accel: number;
  color: string;
  trim: string;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  car: { id: 'car', name: 'Compact car', mass: 900, wheelbase: 2.1, wheelR: 0.36, height: 0.9, speed: 5.5, accel: 7, color: '#e8483b', trim: '#ffd5a8' },
  van: { id: 'van', name: 'Delivery van', mass: 1500, wheelbase: 2.5, wheelR: 0.42, height: 1.3, speed: 5, accel: 6.5, color: '#f4f1e6', trim: '#3a7bd5' },
  truck: { id: 'truck', name: 'Dump truck', mass: 2200, wheelbase: 3.0, wheelR: 0.5, height: 1.5, speed: 4.5, accel: 6, color: '#f29f1f', trim: '#5b4a3a' },
  semi: { id: 'semi', name: 'Semi truck', mass: 4000, wheelbase: 4.6, wheelR: 0.52, height: 1.9, speed: 4, accel: 5, color: '#3a6fd8', trim: '#d8dde6' },
  bus: { id: 'bus', name: 'School bus', mass: 3000, wheelbase: 3.8, wheelR: 0.5, height: 1.8, speed: 4.2, accel: 5.5, color: '#f7c832', trim: '#2b2b2b' },
};
