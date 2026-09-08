import { z } from "zod";
import { idempotencyKeySchema, uuidSchema } from "./common";

export const DEMAND_INITIAL_INVITATIONS=5;
export const demandInvitationStatusSchema=z.enum(["pending","sending","sent","failed","expired","revoked","redeemed"]);
export const demandInvitationSchema=z.object({
  id:uuidSchema,email:z.string().email().max(320),status:demandInvitationStatusSchema,
  createdAt:z.string().datetime(),expiresAt:z.string().datetime(),sentAt:z.string().datetime().nullable(),redeemedAt:z.string().datetime().nullable(),
}).strict();
export const demandInvitationsSchema=z.object({limit:z.literal(DEMAND_INITIAL_INVITATIONS),redeemed:z.number().int().min(0).max(5),
  reserved:z.number().int().min(0).max(5),remaining:z.number().int().min(0).max(5),invitations:z.array(demandInvitationSchema).max(100),
}).strict().refine(value=>value.remaining===value.limit-value.redeemed-value.reserved,"Invitation slots must match settled and pending invitations.");
export const createDemandInvitationSchema=z.object({email:z.string().trim().toLowerCase().email().max(320),idempotencyKey:idempotencyKeySchema}).strict();
export const demandInvitationActionSchema=z.object({idempotencyKey:idempotencyKeySchema}).strict();
export const demandInvitationDeliverySchema=z.enum(["sent","failed","unknown","not_attempted"]);
export const demandInvitationMutationSchema=z.object({invitation:demandInvitationSchema,replayed:z.boolean(),delivery:demandInvitationDeliverySchema}).strict();
export const demandInvitationRedemptionSchema=z.object({invitationId:uuidSchema,admitted:z.literal(true),replayed:z.boolean()}).strict();
export type DemandInvitation=z.infer<typeof demandInvitationSchema>;
export type DemandInvitations=z.infer<typeof demandInvitationsSchema>;
export type CreateDemandInvitation=z.infer<typeof createDemandInvitationSchema>;
export type DemandInvitationAction=z.infer<typeof demandInvitationActionSchema>;
export type DemandInvitationMutation=z.infer<typeof demandInvitationMutationSchema>;
export type DemandInvitationRedemption=z.infer<typeof demandInvitationRedemptionSchema>;
