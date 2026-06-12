/**
 * Shared address shape used by /api/orders (inline shipping) and the
 * /api/account/addresses CRUD.
 * Mirror in ui/src/lib/api-types.ts.
 */
export interface AddressInput {
  label?: string;
  contactName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  /**
   * Free-form country: alpha-2 ("IN"), alpha-3 ("IND"), or name ("India").
   * Server normalizes to canonical English name. Currently only "India" supported.
   */
  country?: string;
}

export interface AddressDto {
  id: string;
  label: string | null;
  contactName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefaultShipping: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressListResponse {
  items: AddressDto[];
}

export interface CreateAddressRequest extends AddressInput {
  setDefault?: boolean;
}

export interface UpdateAddressRequest extends AddressInput {
  setDefault?: boolean;
}

export interface AddressMutationResponse {
  address: AddressDto;
}

export const ADDRESS_MAX_PER_USER = 5;
