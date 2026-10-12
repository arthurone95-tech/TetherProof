import { cache } from 'react';
import type { NotificationsResponse, ReceivedOffersResponse } from '@tetherproof/shared';
import { apiServer } from './api';

/**
 * The shell's shared reads, memoized for one request.
 *
 * The signed-in layout renders around every screen and needs two small numbers:
 * the worker's pending invitations and the member's unread notifications. The
 * Invitations and Notifications pages then render the same two resources in
 * full. Without this, one navigation asks the API the same question twice — once
 * for the badge and once for the page — which doubles the latency of opening
 * either screen and makes a click feel like a reload.
 *
 * `cache` memoizes by argument for the length of a single server render, so the
 * layout and the page under it share one response, and the memo cannot leak from
 * one request (one account) into another. These functions throw like `apiServer`
 * and leave the decision to degrade to the caller: a badge can quietly show
 * zero, while the page that is nothing but the feed needs to report the failure.
 */
export const getNotifications = cache((): Promise<NotificationsResponse> =>
  apiServer<NotificationsResponse>('/notifications'),
);

export const getInvitationInbox = cache((): Promise<ReceivedOffersResponse> =>
  apiServer<ReceivedOffersResponse>('/invites/offers'),
);
