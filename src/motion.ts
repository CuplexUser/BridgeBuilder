/**
 * Whether to keep movement down to what play needs: no camera shake, white flashes or wipes, and
 * fewer confetti. Settings sets it; until then it follows the system's reduced-motion setting.
 */
export const motion = {
  reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};
