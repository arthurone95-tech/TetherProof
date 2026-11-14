import { Router, type Request, type RequestHandler } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { readParam, validateBody, validateParams } from '../../middleware/validate.js';
import type {
  AdminBusinessesResponse,
  BusinessSummary,
  CapabilitiesResponse,
} from '@tetherproof/shared';
import {
  activateSelfService,
  describeCapabilities,
  hasCapability,
  revoke,
} from './service.js';
import {
  activateCapabilitySchema,
  businessDecisionSchema,
  businessIdParamSchema,
  businessMemberSchema,
  createBusinessSchema,
} from './schemas.js';
import {
  addMember,
  createBusiness,
  listBusinesses,
  listBusinessesForAdmin,
  listMembers,
  setBusinessStatus,
} from './businesses.js';

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function account(req: Request): { userId: string } {
  const auth = req.auth;
  if (!auth) throw new Error('authenticate must run first');
  return auth;
}

/**
 * The signed-in account's capabilities.
 *
 * Every route in this file requires only a valid session. Activating a capability is not
 * a privileged act — the whole point of the design is that a person grants it to
 * themselves, subject to the rules in `service.ts`. Requiring a capability to reach the
 * page that grants capabilities would be a catch-22.
 */
export const capabilityRouter = Router();

capabilityRouter.use(authenticate);

capabilityRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const described: CapabilitiesResponse = await describeCapabilities(auth.userId);
    res.json(described);
  }),
);

/**
 * Activates one capability.
 *
 * Delegates to `activateSelfService`, which is where the `SELF_SERVICE` gate lives. The
 * handler does not decide which capabilities are self-service — a second copy of that
 * rule is a second thing to get wrong, and this one decides who is allowed to hire.
 */
capabilityRouter.post(
  '/',
  validateBody(activateCapabilitySchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await activateSelfService(auth.userId, req.body.capability);
    const described = await describeCapabilities(auth.userId);
    res.status(201).json(described);
  }),
);

/**
 * Deactivates one capability.
 *
 * Only the revokable ones: `worker` is refused, because it is what gives a person access
 * to their own records and taking it would strand them with data they cannot reach. The
 * refusal is in the service so it cannot be bypassed by another route.
 */
capabilityRouter.delete(
  '/:capability',
  validateParams(activateCapabilitySchema.pick({ capability: true })),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await revoke(auth.userId, readParam(req, 'capability') as never);
    res.status(204).end();
  }),
);

/** Whether this account holds one capability. Cheap, and the switcher polls it. */
capabilityRouter.get(
  '/:capability',
  validateParams(activateCapabilitySchema.pick({ capability: true })),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const held = await hasCapability(
      auth.userId,
      readParam(req, 'capability') as never,
    );
    res.json({ capability: readParam(req, 'capability'), held });
  }),
);

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

export const businessRouter = Router();

businessRouter.use(authenticate);

/**
 * The account's businesses, and creating one.
 *
 * Open to any signed-in account, because requiring approval *to ask* would leave nobody
 * able to ask. The gate that matters is on hiring, and it is enforced by the capability
 * that only an approved business grants.
 */
businessRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = account(req);
    res.json(await listBusinesses(auth.userId));
  }),
);

businessRouter.post(
  '/',
  validateBody(createBusinessSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const business: BusinessSummary = await createBusiness(auth.userId, req.body.name);
    res.status(201).json(business);
  }),
);

/** Adds a colleague to a business, which grants them the employer capability. */
businessRouter.post(
  '/:businessId/members',
  validateParams(businessIdParamSchema),
  validateBody(businessMemberSchema),
  asyncHandler(async (req, res) => {
    // The member is named by their account id and the business by the URL. `addMember`
    // checks the two against each other — only the owner may add anybody — so there is no
    // path here by which an account can grant hiring rights on a business it does not own.
    const auth = account(req);
    await addMember(readParam(req, 'businessId'), req.body.userId, auth.userId);
    res.status(204).end();
  }),
);

/**
 * The members of a business, for the owner's screen.
 *
 * Read-only and owner-scoped, mirroring the write: the owner is the person who decides who
 * may hire, so only they need the roster.
 */
businessRouter.get(
  '/:businessId/members',
  validateParams(businessIdParamSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    const result = await listMembers(readParam(req, 'businessId'), auth.userId);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const businessAdminRouter = Router();

/**
 * The administrator's business approvals.
 *
 * Admin-only at the mount, and admin is read from the server-controlled claim rather than
 * from a capability, so no account can reach this by activating anything.
 */
businessAdminRouter.use(authenticate, authorize('admin'));

businessAdminRouter.get(
  '/businesses',
  asyncHandler(async (_req, res) => {
    const body: AdminBusinessesResponse = { businesses: await listBusinessesForAdmin() };
    res.json(body);
  }),
);

businessAdminRouter.post(
  '/businesses/:businessId/approval',
  validateParams(businessIdParamSchema),
  validateBody(businessDecisionSchema),
  asyncHandler(async (req, res) => {
    const auth = account(req);
    await setBusinessStatus(
      readParam(req, 'businessId'),
      req.body.status,
      auth.userId,
      req.body.note ?? null,
    );
    res.status(204).end();
  }),
);
