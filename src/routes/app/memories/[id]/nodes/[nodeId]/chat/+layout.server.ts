import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
  // Pass through parent data to the page
  return parent();
};
