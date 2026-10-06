import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import {
  GovernmentAccessService,
  type GovernmentScope,
} from './government-access.service.js';

type GovernmentRequest = AuthenticatedRequest & {
  params: Record<string, string | undefined>;
  government?: GovernmentScope;
};

/**
 * Admits a request to a government office's portal and attaches its proven
 * scope — organisation, membership, jurisdiction predicate — so handlers
 * never look any of it up again from client input.
 */
@Injectable()
export class GovernmentGuard implements CanActivate {
  constructor(private readonly access: GovernmentAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GovernmentRequest>();
    if (!request.user) throw AppException.unauthorized();

    const slug = request.params.slug;
    if (!slug) throw AppException.notFound('Government office');

    request.government = await this.access.resolve(slug, request.user);
    return true;
  }
}

export const CurrentGovernment = createParamDecorator(
  (_data: unknown, context: ExecutionContext): GovernmentScope => {
    const request = context.switchToHttp().getRequest<GovernmentRequest>();
    if (!request.government) {
      throw new Error('CurrentGovernment used on a route without GovernmentGuard.');
    }
    return request.government;
  },
);
