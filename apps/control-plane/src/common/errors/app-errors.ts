import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Coded, user-facing errors. Each carries a stable `code` the web app maps to a
 * localized string, plus an English `message` used as a fallback. Keep codes in
 * sync with the `error.*` keys in the web i18n dictionaries.
 */
export const AuthErrors = {
  emailTaken: () =>
    new ConflictException({
      code: 'auth.emailTaken',
      message: 'An account with this email already exists.',
    }),
  invalidCredentials: () =>
    new UnauthorizedException({
      code: 'auth.invalidCredentials',
      message: 'Invalid email or password.',
    }),
  totpRequired: () =>
    new UnauthorizedException({
      code: 'auth.totpRequired',
      message: 'A two-factor authentication code is required.',
    }),
  totpInvalid: () =>
    new UnauthorizedException({
      code: 'auth.totpInvalid',
      message: 'The two-factor code is invalid or has expired.',
    }),
  alreadyOnboarded: () =>
    new BadRequestException({
      code: 'auth.alreadyOnboarded',
      message: 'Onboarding has already been completed.',
    }),
  invalidRefresh: () =>
    new UnauthorizedException({
      code: 'auth.invalidRefresh',
      message: 'Your session has expired. Please sign in again.',
    }),
  currentPasswordInvalid: () =>
    new BadRequestException({
      code: 'auth.currentPasswordInvalid',
      message: 'The current password is incorrect.',
    }),
  weakPassword: () =>
    new BadRequestException({
      code: 'auth.weakPassword',
      message:
        'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a special character and at least 3 digits.',
    }),
  twoFactorAlreadyEnabled: () =>
    new BadRequestException({
      code: 'auth.twoFactorAlreadyEnabled',
      message: 'Two-factor authentication is already enabled.',
    }),
  twoFactorNotEnabled: () =>
    new BadRequestException({
      code: 'auth.twoFactorNotEnabled',
      message: 'Two-factor authentication is not enabled.',
    }),
};

export const CommonErrors = {
  adminOnly: () =>
    new ForbiddenException({
      code: 'common.adminOnly',
      message: 'This action is restricted to administrators.',
    }),
};

export const LicenseErrors = {
  invalidKey: () =>
    new BadRequestException({
      code: 'license.invalidKey',
      message: 'The license key is invalid or malformed.',
    }),
  expiredKey: () =>
    new BadRequestException({
      code: 'license.expiredKey',
      message: 'The license key has expired.',
    }),
  moduleLocked: (module: string, tier: string) =>
    new ForbiddenException({
      code: 'license.moduleLocked',
      message: `This feature requires the ${tier} plan. Upgrade in Billing to unlock it.`,
      meta: { module, tier },
    }),
};

export const TemplateErrors = {
  notFound: () =>
    new BadRequestException({
      code: 'template.notFound',
      message: 'Template not found.',
    }),
  inUse: () =>
    new BadRequestException({
      code: 'template.inUse',
      message: 'This template is used by one or more services and cannot be deleted.',
    }),
};

export const ProjectErrors = {
  limitBelowAllocated: () =>
    new BadRequestException({
      code: 'project.limitBelowAllocated',
      message:
        'Project limit cannot be lower than resources already allocated to services.',
    }),
  cpuOverCapacity: () =>
    new BadRequestException({
      code: 'project.cpuOverCapacity',
      message: 'Project CPU limit exceeds platform capacity.',
    }),
  memOverCapacity: () =>
    new BadRequestException({
      code: 'project.memOverCapacity',
      message: 'Project memory limit exceeds platform capacity.',
    }),
};

export const NodeErrors = {
  agentUnreachable: (node: string) =>
    new BadGatewayException({
      code: 'nodes.agentUnreachable',
      message: `The agent on node "${node}" is unreachable. Make sure it is running (Nodes → Start agent).`,
      meta: { node },
    }),
};

export const MemberErrors = {
  userNotFound: () =>
    new BadRequestException({
      code: 'members.userNotFound',
      message: 'No user with that email — they must register first.',
    }),
  ownerReserved: () =>
    new BadRequestException({
      code: 'members.ownerReserved',
      message: 'Use transfer-ownership to assign the OWNER role.',
    }),
  ownerImmutable: () =>
    new BadRequestException({
      code: 'members.ownerImmutable',
      message: 'The project owner role cannot be changed directly.',
    }),
  ownerRemoval: () =>
    new BadRequestException({
      code: 'members.ownerRemoval',
      message: 'The project owner cannot be removed.',
    }),
};
