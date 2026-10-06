import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationMemberRole } from '@samadhaan/shared';
import type { AuthenticatedRequest } from '../../auth/auth.types.js';
import { AppException } from '../../common/app.exception.js';
import {
  OrganizationAccessService,
  type WorkspaceContext,
} from '../organization-access.service.js';

const WORKSPACE_ROLES_KEY = 'samadhaan:workspaceRoles';

/**
 * Restricts a workspace route to some membership roles. Without it, any active
 * member may use the route.
 */
export const WorkspaceRoles = (...roles: OrganizationMemberRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);

type WorkspaceRequest = AuthenticatedRequest & {
  params: Record<string, string | undefined>;
  workspace?: WorkspaceContext;
};

/**
 * Admits a request to an organisation workspace.
 *
 * The organisation comes from the `:slug` path parameter and the user from the
 * verified session — never from a body, header or query string. The guard then
 * walks the whole chain in `OrganizationAccessService.resolveWorkspace`
 * (exists → workspace type → active membership → not suspended) and, when the
 * route declares `@WorkspaceRoles`, checks the membership role too.
 *
 * The proven context is attached to the request, so handlers read the
 * organisation and membership through `@CurrentWorkspace()` instead of looking
 * them up again — there is no second lookup to get wrong.
 */
@Injectable()
export class OrganizationWorkspaceGuard implements CanActivate {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();

    // The global JwtAuthGuard runs first; this is a belt-and-braces check for
    // a route that was accidentally marked public.
    if (!request.user) throw AppException.unauthorized();

    const slug = request.params.slug;
    if (!slug) throw AppException.notFound('Organisation');

    const workspace = await this.access.resolveWorkspace(slug, request.user);

    const roles = this.reflector.getAllAndOverride<OrganizationMemberRole[] | undefined>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(workspace.membership.membershipRole)) {
      throw AppException.forbidden('Your role in this organisation does not allow that.');
    }

    request.workspace = workspace;
    return true;
  }
}

/** The workspace proven by `OrganizationWorkspaceGuard`. */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceContext => {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();

    if (!request.workspace) {
      throw new Error(
        'CurrentWorkspace used on a route without OrganizationWorkspaceGuard.',
      );
    }

    return request.workspace;
  },
);
