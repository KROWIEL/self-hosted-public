// English message catalog. This is the canonical dictionary: its keys define
// the shape every other locale must implement (see ru.ts).
export const en = {
  // Common
  'common.loading': 'Loading…',
  'common.failed': 'Something went wrong',
  'common.delete': 'Delete',
  'common.create': 'Create',
  'common.creating': 'Creating…',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.set': 'Set',
  'common.dismiss': 'Dismiss',
  'common.guideHide': 'Hide guide',
  'common.guideShow': 'Show guide',
  'common.collapse': 'Collapse',
  'common.expand': 'Expand',
  'common.signOut': 'Sign out',
  'common.edit': 'Edit',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.saved': 'Saved',
  'common.close': 'Close',
  'common.done': 'Done',
  'common.remove': 'Remove',

  // Members / roles
  'members.title': 'Members',
  'members.hint':
    'People with access to this project. Roles: Viewer (read-only), Member (deploy & operate), Admin (manage settings & members), Owner (full control).',
  'members.email': 'Email',
  'members.roleLabel': 'Role',
  'members.add': 'Add',
  'members.added': 'Member added',
  'members.role.OWNER': 'Owner',
  'members.role.ADMIN': 'Admin',
  'members.role.MEMBER': 'Member',
  'members.role.VIEWER': 'Viewer',
  'members.role.NONE': 'none',

  // Audit log
  'audit.title': 'Audit log',
  'audit.show': 'Show',
  'audit.hide': 'Hide',
  'audit.empty': 'No activity recorded yet.',

  // Cleanup / prune
  'cleanup.button': 'Clean up',
  'cleanup.title': 'Reclaim disk space',
  'cleanup.subtitle':
    'Remove Docker junk that builds up over time — stopped containers, dangling images, build cache and unused networks.',
  'cleanup.always':
    'Always removed: stopped containers, unused networks, dangling images and the build cache.',
  'cleanup.allImages': 'Also remove all unused images',
  'cleanup.allImagesHint':
    'Deletes every image not used by a running container. They will be re-pulled/rebuilt on the next deploy.',
  'cleanup.volumes': 'Also remove unused volumes',
  'cleanup.volumesHint':
    'Destructive: deletes volumes not attached to any container. May erase data of stopped databases.',
  'cleanup.confirm':
    'Run cleanup on this node? This removes stopped containers, dangling images and build cache.',
  'cleanup.confirmVolumes':
    'Run cleanup including unused volumes? This can permanently delete data from volumes not attached to a running container.',
  'cleanup.confirmTitle': 'Confirm cleanup',
  'cleanup.running': 'Cleaning…',
  'cleanup.done': 'Cleanup finished.',
  'cleanup.freedSystem': 'System prune',
  'cleanup.freedBuilder': 'Build cache',
  'cleanup.freedVolumes': 'Volumes',

  // Language switcher
  'lang.ru': 'RU',
  'lang.en': 'EN',

  // Shared field labels
  'field.node': 'Node',
  'field.template': 'Template',

  // Navigation
  'nav.projects': 'Projects',
  'nav.nodes': 'Nodes',
  'nav.tunnels': 'Exposure',
  'nav.templates': 'Templates',
  'nav.git': 'Git access',
  'nav.audit': 'Audit log',
  'nav.alerts': 'Alerts',
  'nav.offsite': 'Offsite backups',
  'nav.apiTokens': 'API tokens',
  'nav.metrics': 'Metrics',
  'nav.whiteLabel': 'White-label',
  'nav.sso': 'Single sign-on',
  'nav.previews': 'Preview envs',
  'nav.email': 'Email',
  'nav.settings': 'Settings',
  'nav.billing': 'Billing',
  'nav.locked': 'Requires an upgrade',
  'nav.openMenu': 'Open menu',
  'nav.closeMenu': 'Close menu',
  'nav.collapse': 'Hide sidebar',
  'nav.expand': 'Show sidebar',

  // Home
  'home.subtitle':
    'Deploy your SaaS projects — Java backends and React/Next.js frontends — from a git repository into Docker, behind a reverse proxy with HTTPS.',
  'home.signIn': 'Sign in',
  'home.openDashboard': 'Open dashboard',

  // Login
  'login.welcome': 'Welcome back',
  'login.subtitle': 'Sign in to your panel',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.signIn': 'Sign in',
  'login.signingIn': 'Signing in…',
  'login.failed': 'Login failed',
  'login.totp': 'Two-factor code',
  'login.totpHint': 'Enter the 6-digit code from your authenticator app.',
  'login.noAccount': "Don't have an account?",
  'login.register': 'Create one',
  'login.or': 'or',

  // Registration (stage 1)
  'register.title': 'Create your account',
  'register.subtitle': 'Step 1 of 2 — account details',
  'register.passwordHint': 'At least 8 characters.',
  'register.continue': 'Continue',
  'register.creating': 'Creating…',
  'register.haveAccount': 'Already have an account?',
  'register.signIn': 'Sign in',

  // Onboarding (stage 2)
  'onboarding.title': 'Complete your profile',
  'onboarding.subtitle': 'Step 2 of 2 — personal details & two-factor auth',
  'onboarding.firstName': 'First name',
  'onboarding.lastName': 'Last name',
  'onboarding.2faTitle': 'Two-factor authentication',
  'onboarding.2faHint':
    'Scan the QR code with Google Authenticator, 1Password or any TOTP app, then enter the 6-digit code to confirm.',
  'onboarding.secretManual': "Can't scan? Enter this key manually:",
  'onboarding.code': '6-digit code',
  'onboarding.finish': 'Finish setup',
  'onboarding.finishing': 'Finishing…',

  // Account settings
  'settings.title': 'Account settings',
  'settings.subtitle': 'Manage your profile, password and two-factor auth.',
  'settings.profileTitle': 'Personal data',
  'settings.profileHint': 'Your name shown across the panel.',
  'settings.firstName': 'First name',
  'settings.lastName': 'Last name',
  'settings.email': 'Email',
  'settings.emailHint': 'Email is used to sign in and cannot be changed here.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.profileSaved': 'Profile updated',
  'settings.passwordTitle': 'Password',
  'settings.passwordHint': 'Use at least 8 characters.',
  'settings.currentPassword': 'Current password',
  'settings.newPassword': 'New password',
  'settings.confirmPassword': 'Confirm new password',
  'settings.changePassword': 'Change password',
  'settings.changingPassword': 'Changing…',
  'settings.passwordChanged': 'Password changed',
  'settings.passwordMismatch': 'The new passwords do not match.',
  'settings.2faTitle': 'Two-factor authentication',
  'settings.2faStatusOn': 'Enabled',
  'settings.2faStatusOff': 'Disabled',
  'settings.2faOnHint':
    'A code from your authenticator app is required at sign-in.',
  'settings.2faOffHint':
    'Add an extra layer of security using a TOTP authenticator app.',
  'settings.enable2fa': 'Enable 2FA',
  'settings.enabling': 'Enabling…',
  'settings.confirmEnable': 'Confirm & enable',
  'settings.disable2fa': 'Disable 2FA',
  'settings.disabling': 'Disabling…',
  'settings.2faEnabledMsg': 'Two-factor authentication enabled',
  'settings.2faDisabledMsg': 'Two-factor authentication disabled',
  'settings.scanHint':
    'Scan the QR code with your authenticator app, then enter the 6-digit code.',
  'settings.secretManual': "Can't scan? Enter this key manually:",
  'settings.code': '6-digit code',
  'settings.passwordToDisable': 'Enter your password to disable 2FA.',
  'settings.mustChangeTitle': 'Your password needs to be updated',
  'settings.mustChangeHint':
    'Your current password does not meet the security policy. Please set a stronger password below to continue.',

  // Password policy checklist
  'password.rule.length': 'At least 12 characters',
  'password.rule.upper': 'An uppercase letter (A–Z)',
  'password.rule.lower': 'A lowercase letter (a–z)',
  'password.rule.digits': 'At least 3 digits',
  'password.rule.special': 'A special character (!@#$…)',

  // API error codes (mapped from the control-plane `code` field)
  'error.auth.emailTaken': 'An account with this email already exists.',
  'error.auth.invalidCredentials': 'Invalid email or password.',
  'error.auth.totpRequired': 'A two-factor authentication code is required.',
  'error.auth.totpInvalid': 'The two-factor code is invalid or has expired.',
  'error.auth.alreadyOnboarded': 'Onboarding has already been completed.',
  'error.auth.invalidRefresh': 'Your session has expired. Please sign in again.',
  'error.auth.currentPasswordInvalid': 'The current password is incorrect.',
  'error.auth.weakPassword':
    'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a special character and at least 3 digits.',
  'error.auth.twoFactorAlreadyEnabled':
    'Two-factor authentication is already enabled.',
  'error.auth.twoFactorNotEnabled':
    'Two-factor authentication is not enabled.',
  'error.common.adminOnly': 'This action is restricted to administrators.',
  'error.template.notFound': 'Template not found.',
  'error.template.inUse':
    'This template is used by one or more services and cannot be deleted.',
  'error.members.userNotFound':
    'No user with that email — they must register first.',
  'error.members.ownerReserved':
    'Use transfer-ownership to assign the Owner role.',
  'error.members.ownerImmutable':
    'The project owner role cannot be changed directly.',
  'error.members.ownerRemoval': 'The project owner cannot be removed.',
  'error.members.forbidden':
    'Requires the {min} role on this project (you have {role}).',
  'error.project.limitBelowAllocated':
    'The limit cannot be lower than resources already allocated to services.',
  'error.project.cpuOverCapacity': 'The CPU limit exceeds platform capacity.',
  'error.project.memOverCapacity':
    'The memory limit exceeds platform capacity.',
  'error.nodes.agentUnreachable':
    'The agent on node “{node}” is unreachable. Make sure it is running (Nodes → Start agent).',
  'error.license.invalidKey': 'The license key is invalid or malformed.',
  'error.license.expiredKey': 'The license key has expired.',
  'error.license.moduleLocked':
    'This feature requires the {tier} plan. Upgrade in Billing to unlock it.',
  'error.license.nodeLimit':
    'Your plan allows at most {max} node(s). Upgrade in Billing to add more.',
  'error.license.tunnelLimit':
    'Your plan allows at most {max} reverse tunnel(s). Upgrade in Billing to add more.',
  'error.sso.notLicensed': 'Single sign-on requires the Pro plan.',
  'error.sso.notConfigured':
    'Single sign-on is not configured. Ask an administrator to set it up.',
  'error.email.notConfigured':
    'Email is not configured. Set the SMTP host, credentials and sender address first.',
  'error.email.noRecipients':
    'No valid recipients — add at least one address or pick “all users”.',
  'error.email.sendFailed': 'The SMTP server rejected the message: {reason}',
  'error.network.unreachable':
    'Cannot reach the server. Check your connection.',
  'error.http.requestFailed': 'Request failed ({status}).',

  // Projects (dashboard)
  'projects.title': 'Projects',
  'projects.subtitle': 'Group your services. Each deploys from git into a container.',
  'projects.aboutTitle': 'What is a project?',
  'projects.aboutBody':
    'A project groups related services (e.g. a backend and a frontend) and the managed databases they share. It’s your unit of organization — you create services inside a project and they can talk to the same database.',
  'projects.step1Title': 'Create a project',
  'projects.step1Body':
    'Name it after your app or environment (e.g. “Shop” or “Staging”). Add as many as you need.',
  'projects.step2Title': 'Add services & databases',
  'projects.step2Body':
    'Open a project to add services (built from git) and optional managed databases they connect to.',
  'projects.step3Title': 'Deploy & monitor',
  'projects.step3Body':
    'Deploy each service, set env vars and a domain, and watch status right here on the overview.',
  'projects.newPlaceholder': 'New project name',
  'projects.nameLabel': 'Project name',
  'projects.create': 'Create project',
  'projects.empty': 'No projects yet. Create one above.',
  'projects.noServices': 'No services',
  'projects.confirmDelete': 'Delete this project and all its services?',

  // Nodes
  'nodes.title': 'Nodes',
  'nodes.subtitle':
    'Servers where your apps actually build and run. Register a server, start its agent, then deploy services to it.',
  'nodes.aboutTitle': 'What is a node and how does it work?',
  'nodes.aboutBody':
    'A node is any server (VPS or bare metal) with Docker and the lightweight agent installed. The panel never touches Docker directly — it sends commands to each node’s agent, which builds images, runs containers and reports status back. Every service you deploy lives on a node.',
  'nodes.step1Title': 'Register the node',
  'nodes.step1Body':
    'Add the server below with a name, its host/IP and the agent port. You’ll get a one-time daemon token — the panel uses it to authenticate to the agent.',
  'nodes.step2Title': 'Install & run the agent',
  'nodes.step2Body':
    'On the server, run the agent with that token (via the shown command or as a systemd service). It listens on the agent port and connects the node to the panel.',
  'nodes.step3Title': 'Start & deploy',
  'nodes.step3Body':
    'Once the agent is up, the node shows “Running” with live metrics. Pick this node when creating a service, then deploy from git.',
  'nodes.manageTitle': 'Managing nodes',
  'nodes.manageBody':
    'Use Start / Stop to control the agent, “Log” to inspect its output, and live metrics show containers, image size and reclaimable space. Delete removes the node from the panel (it does not wipe the server). A node with running services can’t be deleted until they’re removed.',
  'nodes.guideHide': 'Hide guide',
  'nodes.guideShow': 'Show guide',
  'nodes.addTitle': 'Register a node',
  'nodes.connectionSection': 'Connection',
  'nodes.capacitySection': 'Resource budget',
  'nodes.tokenOnce': 'Daemon token for {name} — shown only once.',
  'nodes.namePlaceholder': 'e.g. prod-eu-1',
  'nodes.fqdnPlaceholder': 'e.g. 203.0.113.5 or node.example.com',
  'nodes.portPlaceholder': '8443',
  'nodes.nameLabel': 'Name',
  'nodes.nameHint': 'A label to recognise this server in the panel.',
  'nodes.fqdnLabel': 'Host / address',
  'nodes.fqdnHint': 'Public IP or domain the panel uses to reach the agent.',
  'nodes.portLabel': 'Agent port',
  'nodes.portHint': 'Port the agent listens on (default 8443).',
  'nodes.capacityHint':
    'Capacity is how much of this machine you allow the platform to use for workloads. The recommended mark is only a small baseline for the node agent/runtime overhead, not a limit for all services.',
  'nodes.add': 'Add node',
  'nodes.addLocal': 'Local agent',
  'nodes.addRemote': 'Add remote node',
  'nodes.addRemoteTitle': 'Add a remote node',
  'nodes.addRemoteHint':
    'Register a server, then run one command on it to install and enroll the agent over TLS.',
  'nodes.installTitle': 'Install command',
  'nodes.installBody':
    'Run this on the target server (Docker + root required). The agent generates a TLS identity, enrolls with the panel using a one-time token, and comes online automatically.',
  'nodes.installCommand': 'Install command (Linux)',
  'nodes.joinTokenNote':
    'The join token is one-time and expires in 1 hour. Re-open this dialog to generate a fresh command.',
  'nodes.agentVersion': 'agent {version}',
  'nodes.lastSeen': 'last seen {time}',
  'nodes.notEnrolled': 'awaiting enrollment',
  'nodes.adding': 'Adding…',
  'nodes.empty': 'No nodes registered yet.',
  'nodes.limitHint': '{count} of {max} nodes used on your plan.',
  'nodes.limitReached': 'Your plan allows at most {max} node(s).',
  'nodes.limitUpgrade': 'Upgrade for more.',
  'nodes.start': 'Start agent',
  'nodes.stop': 'Stop agent',
  'nodes.startConfirm': 'Start this node agent?',
  'nodes.stopConfirm':
    'Stop this node agent? Running services may become unmanaged from the panel.',
  'nodes.log': 'Log',
  'nodes.hideLog': 'Hide log',
  'nodes.confirmDelete': 'Delete this node?',
  'nodes.disabledHint':
    'Local agent control disabled. Start it manually, or set LOCAL_AGENT_ENABLED=1.',
  'nodes.disabledTitle':
    'Set LOCAL_AGENT_ENABLED=1 to control the agent from the UI',
  'nodes.agentUnreachable': 'Agent is marked as running, but is unreachable',
  'nodes.containers': 'Containers',
  'nodes.images': 'Images',
  'nodes.reclaimable': 'Reclaimable',
  'nodes.volumes': 'Volumes',
  'nodes.hostLoad': 'CPU load / cores',
  'nodes.hostRam': 'Host RAM',
  'nodes.hostDisk': 'Host disk',
  'nodes.hostMemPerc': 'RAM used',
  'nodes.servicesOnNode': 'Services',
  'nodes.databasesOnNode': 'Databases',
  'nodes.noServices': 'No services on this node.',
  'nodes.noDatabases': 'No databases on this node.',

  // Resources
  'resources.serviceTitle': 'Resources',
  'resources.serviceHint':
    'Allocated limits are configured on the service; current usage is live data from the node agent.',
  'resources.allocatedCpu': 'Allocated CPU',
  'resources.allocatedRam': 'Allocated RAM',
  'resources.currentCpu': 'Current CPU',
  'resources.currentRam': 'Current RAM',
  'resources.currentUsage': 'Current usage',
  'resources.allocated': 'Allocated',
  'resources.cpuUnit': 'CPU cores',
  'resources.ramUnit': 'Memory limit in MB',
  'resources.limitConfigured': 'configured limit',
  'resources.liveFromAgent': 'live from agent',
  'resources.partialLive': 'partial live data',
  'resources.agentStatsUnavailable': 'Agent stats unavailable',
  'resources.services': 'Services',
  'resources.runningTotal': 'running / total',
  'resources.runningServices': 'Running services',
  'resources.cpuRam': 'CPU / RAM',
  'resources.cpu': 'CPU',
  'resources.memory': 'Memory',
  'resources.cpuLimit': 'CPU limit',
  'resources.memLimit': 'Memory limit (MB)',
  'resources.cpuCapacity': 'CPU capacity',
  'resources.memCapacity': 'Memory capacity (MB)',
  'resources.available': 'available',
  'resources.inUse': 'in use',
  'resources.recommended': 'recommended',
  'resources.nodeOverheadRecommended': 'node overhead baseline',
  'resources.platformCapacity': 'Platform capacity',
  'resources.detectedHardware': 'detected hardware',
  'resources.projectResources': 'Project resources',
  'resources.configureProject': 'Configure project limits',
  'resources.configureCapacity': 'Configure capacity',
  'resources.editServiceLimits': 'Edit service limits',
  'resources.projectLimitHint':
    'Project limits reserve part of platform capacity. Services inside the project cannot exceed the remaining project quota.',
  'resources.alreadyAllocated':
    'Already allocated to services: {cpu} CPU / {mem} MB RAM.',

  // Templates
  'templates.title': 'Templates',
  'templates.subtitle': 'Stack definitions used to build & run services.',
  'templates.aboutTitle': 'What are templates?',
  'templates.aboutBody':
    'A template is a ready-made recipe for a stack — which image builds your code, which image runs it, the Dockerfile and the default port. When you create a service you pick a template, and the node’s agent uses it to build and run your app. You can override the port or use the repo’s own Dockerfile per service.',
  'templates.noteTitle': 'Built-in & custom templates',
  'templates.noteBody':
    'The panel ships with templates for common Java and JS/TS stacks. Administrators can create new templates, edit any template (including built-in ones) and group them into categories.',
  'templates.builtIn': 'built-in',
  'templates.new': 'New template',
  'templates.empty': 'No templates yet.',
  'templates.uncategorized': 'Other',
  'templates.created': 'Template created',
  'templates.updated': 'Template updated',
  'templates.deleted': 'Template deleted',
  'templates.editTitle': 'Edit template',
  'templates.editBuiltInHint':
    'This is a built-in template. Your changes apply to everyone on this panel.',
  'templates.deleteTitle': 'Delete template',
  'templates.deleteConfirm':
    'Delete this template? Services already created keep working; only new services lose it.',
  'templates.f.name': 'Name',
  'templates.f.category': 'Category',
  'templates.f.categoryHint': 'Group label (leave empty for “Other”).',
  'templates.f.description': 'Description',
  'templates.f.type': 'Type',
  'templates.f.port': 'Default port',
  'templates.f.healthcheck': 'Healthcheck path',
  'templates.f.baseImage': 'Runtime image',
  'templates.f.installImage': 'Build image',
  'templates.f.dockerfilePath': 'Dockerfile path',
  'templates.f.dockerfilePathHint': 'Path to the Dockerfile inside the panel repo.',
  'templates.f.buildCommand': 'Build command',
  'templates.f.runCommand': 'Run command',
  'templates.f.installScript': 'Build script',
  'templates.f.installScriptHint':
    'Shell script executed in the build image to produce the artifact.',
  'templates.f.variables': 'Variables',
  'templates.f.addVariable': 'Add variable',
  'templates.f.noVariables': 'No variables declared.',
  'templates.f.varName': 'Label',
  'templates.f.varDefault': 'Default value',
  'templates.f.varDescription': 'Description (optional)',
  'templates.desc.javaMaven':
    'Builds a Maven project into a JAR and runs it on Temurin 21.',
  'templates.desc.javaGradle':
    'Builds a Gradle project (via the repo wrapper) into a JAR and runs it on Temurin 25.',
  'templates.desc.nextjs':
    'Builds a Next.js app (standalone output) and runs it on Node 20.',
  'templates.desc.reactVite':
    'Builds a Vite React SPA and serves the static assets with nginx.',

  // Project detail
  'project.back': '← Projects',
  'project.aboutTitle': 'Working inside a project',
  'project.aboutBody':
    'Here you add services and managed databases, then deploy. A service builds an image from git and runs as a container on a node; a database is a shared sidecar container other services in the project connect to.',
  'project.step1Title': 'Add a service',
  'project.step1Body':
    'Pick a node, a template and a git repo. Optionally use the repo’s own Dockerfile.',
  'project.step2Title': 'Add a database (optional)',
  'project.step2Body':
    'Provision Postgres/MySQL once; multiple services can share it via injected connection env vars.',
  'project.step3Title': 'Open a service to deploy',
  'project.step3Body':
    'Set env vars, a domain and volumes, then deploy and manage backups from the service page.',
  'project.services': 'Services',
  'project.noServices': 'No services yet. Create one below.',
  'project.newService': 'New service',
  'project.registerNodeFirst': 'Register a node first on the Nodes page.',
  'project.serviceName': 'Service name',
  'project.repoPlaceholder': 'https://github.com/you/repo',
  'project.branch': 'Branch',
  'project.port': 'Port',
  'project.createService': 'Create service',
  'project.createServiceHint':
    'Create a service from a git repository, choose where it runs, and assign its initial CPU/RAM limits.',
  'project.useRepoDockerfile': "Use the repo's own Dockerfile (if present)",
  'project.useRepoDockerfileHint':
    'Off: build with the selected template. On: use a Dockerfile from the repository (must build from source).',
  'project.gitCred': 'Git access',
  'project.gitCredNone': 'Public (no token)',
  'project.gitCredHint': 'Select a credential to clone a private repository.',

  // Git credentials
  'git.title': 'Git access',
  'git.subtitle':
    'Personal Access Tokens used to clone private repositories. Tokens are encrypted at rest and never returned.',
  'git.aboutTitle': 'Why git credentials?',
  'git.aboutBody':
    'Public repos clone without auth. Private repos need a token. Add a Personal Access Token (PAT) once and attach it to a service — the node uses it only at build time to clone your code. Tokens are encrypted at rest and never shown again.',
  'git.step1Title': 'Create a PAT',
  'git.step1Body':
    'On GitHub/GitLab, create a token with read access to your repositories (repo / read_repository scope).',
  'git.step2Title': 'Add it here',
  'git.step2Body':
    'Give it a name, pick the provider and paste the token. Add a username if your provider requires it.',
  'git.step3Title': 'Use & verify',
  'git.step3Body':
    'Select this credential when creating a service, and use “Verify” below to test access to a repo URL.',
  'git.securityNote':
    'Security: paste only read-only repository tokens. The token is encrypted at rest and shown only as masked data after saving.',
  'git.name': 'Name',
  'git.namePlaceholder': 'e.g. GitHub (personal)',
  'git.provider': 'Provider',
  'git.username': 'Username (optional)',
  'git.usernamePlaceholder': 'leave empty for token auth',
  'git.pat': 'Personal Access Token',
  'git.patPlaceholder': 'ghp_… / glpat-…',
  'git.add': 'Add credential',
  'git.adding': 'Adding…',
  'git.empty': 'No git credentials yet. Add one above.',
  'git.confirmDelete': 'Delete this credential?',
  'git.verify': 'Verify',
  'git.verifying': 'Verifying…',
  'git.verifyRepoPlaceholder': 'https://github.com/you/private-repo',
  'git.repoLabel': 'Repository URL',
  'git.verifyHint': 'Enter a repo URL to test access via git ls-remote.',

  // Service detail
  'service.back': '← Project',
  'service.aboutTitle': 'How a service deploys & runs',
  'service.aboutBody':
    'A service builds a Docker image from your git repo and runs it as a container on its node. Everything you configure here — env vars, domain, volumes, resources, zero-downtime — takes effect on the next deploy.',
  'service.step1Title': 'Configure',
  'service.step1Body':
    'Set env vars and secrets, attach a domain, add volumes and adjust CPU/memory in Settings.',
  'service.step2Title': 'Deploy',
  'service.step2Body':
    'Hit Deploy to build from git and start the container. Watch the build and runtime logs live.',
  'service.step3Title': 'Operate',
  'service.step3Body':
    'Roll back to a previous image, open a terminal, stream logs and stats, or enable zero-downtime deploys.',
  'service.image': 'image',
  'service.deploy': 'Deploy',
  'service.deployConfirm':
    'Start a new deploy now? This will build from git and may replace the running container.',
  'service.start': 'Start',
  'service.startConfirm': 'Start this service container?',
  'service.stop': 'Stop',
  'service.stopConfirm': 'Stop this service container? The app may become unavailable.',
  'service.restart': 'Restart',
  'service.restartConfirm': 'Restart this service container now?',
  'service.delete': 'Delete',
  'service.confirmDelete': 'Delete this service and its container?',
  'service.deployments': 'Deployments',
  'service.noDeployments': 'No deployments yet.',
  'service.showLog': 'Show log',
  'service.hideLog': 'Hide log',
  'service.noBuildLog': '(no build log)',
  'service.buildLogLive': 'Build log (live)',
  'service.buildLogWaiting': 'Waiting for build output…',
  'service.environment': 'Environment',
  'service.noVariables': 'No variables.',
  'service.secret': 'secret',
  'service.envDelete': 'Delete variable',
  'service.envDeleteConfirm': 'Delete this variable? Applied on the next deploy.',
  'service.envSetConfirm':
    'Set this environment variable? It may affect the next deploy/runtime.',
  'service.envImport': 'Import .env',
  'service.envImportConfirm':
    'Import these environment variables? Existing keys with the same name will be overwritten.',
  'service.envImportHint':
    'Paste a .env file. KEY=VALUE per line; #comments and quotes are handled. Existing keys are overwritten. Secrets are auto-detected by name.',
  'service.envImportBtn': 'Import',
  'service.envImportCount': '{n} variable(s) detected',
  'service.envImportEmpty': 'No valid KEY=VALUE lines found.',
  // Repo auto-setup
  'setup.button': 'Scan & setup',
  'setup.title': 'Scan repo & auto-setup',
  'setup.hint':
    'Clones the repo and detects databases (docker-compose / .env) and env keys. Selected databases are created and wired up; selected keys are added (DB keys filled automatically, others left blank).',
  'setup.scanning': 'Scanning repository…',
  'setup.databases': 'Detected databases',
  'setup.noDatabases': 'No databases detected.',
  'setup.willCreate': '— will be created & linked',
  'setup.schemas': 'schemas',
  'setup.envFrom': 'Environment from {file}',
  'setup.envNone': 'No .env example found.',
  'setup.exists': 'exists',
  'setup.apply': 'Apply',
  'setup.applyConfirm':
    'Apply detected setup changes? This may create databases and overwrite selected environment variables.',
  'setup.applying': 'Applying…',
  'service.keyPlaceholder': 'KEY',
  'service.valuePlaceholder': 'value',
  'service.domain': 'Domain',
  'service.domainConfirm':
    'Save this domain configuration? Traffic routing and certificates may change.',
  'service.domainPlaceholder': 'example.com',
  'service.domainHint':
    'Use the apex domain (example.com). Traefik routes all subdomains too (admin.example.com, tenant.example.com). For HTTPS add DNS: A *.example.com → VDS IP. For one wildcard cert: ACME_WILDCARD_CERTS=1 + Cloudflare DNS API token in .env.',
  'service.https': "HTTPS (Let's Encrypt)",
  'service.logs': 'Live logs',
  'service.logsStart': 'Stream',
  'service.logsStop': 'Stop',
  'service.logsClear': 'Clear',
  'service.logsEmpty': 'Not streaming. Press “Stream” to watch live container output.',
  'service.logsConnecting': 'Connecting…',
  'service.logsEnded': '— stream ended —',
  'service.rollback': 'Rollback',
  'service.rollbackConfirm': 'Redeploy this image (rollback)?',
  'service.webhook': 'Auto-deploy webhook',
  'service.webhookHint':
    'Send a POST to this URL (e.g. from a Git push webhook) to trigger a deploy. Keep the token secret.',
  'service.copy': 'Copy',
  'service.copied': 'Copied',
  'service.info': 'Overview',
  'service.node': 'Node',
  'service.template': 'Template',
  'service.port': 'Port',
  'service.repo': 'Repository',
  'service.gitAccess': 'Git access',
  'service.open': 'Open app',
  'service.settings': 'Settings',
  'service.settingsHint': 'Changes take effect on the next deploy.',
  'service.settingsConfirm':
    'Save these service settings? Changes may affect the next deploy and runtime limits.',
  'service.name': 'Name',
  'service.cpu': 'CPU limit',
  'service.mem': 'Memory limit (MB)',
  'service.zeroDowntime': 'Zero-downtime deploy',
  'service.zeroDowntimeHint':
    'Start a new instance and wait for its health check before switching traffic and stopping the old one. Requires a domain.',
  'service.healthcheckPath': 'Health check path',
  'service.healthTimeout': 'Health timeout (s)',
  'service.activeColor': 'Active instance',
  'service.zeroDowntimeVolumeWarn':
    'Unavailable while the service has persistent volumes — two instances would share the same volume.',
  'service.stepBuild': 'Build',
  'service.stepHealth': 'Health',
  'service.stepSwitchover': 'Switchover',
  'service.stepDeploy': 'Deploy',
  'service.stepLive': 'Live',
  'service.deploymentsShowAll': 'Show history ({count})',
  'service.deploymentsHide': 'Hide history',
  'service.terminal': 'Terminal',
  'service.terminalTitle': 'Container shell',
  'service.terminalHint':
    'Interactive shell inside the running container — inspect files, connect to the database, fix things by hand.',
  'service.terminalConnecting': 'Connecting…',
  'service.terminalClosed': 'Session closed',
  'service.terminalReconnecting': 'Reconnecting…',
  'service.terminalReconnected': 'Reconnected',
  'service.terminalNotRunning': 'Start the container to open a shell.',
  'service.close': 'Close',
  // Persistent volumes
  'volume.title': 'Persistent volumes',
  'volume.hint': 'Mounted into the container. Data survives redeploys. Applied on the next deploy.',
  'volume.mountPath': 'Mount path (e.g. /data)',
  'volume.add': 'Add volume',
  'volume.addConfirm':
    'Add this persistent volume? It will be mounted into the service on the next deploy.',
  'volume.none': 'No volumes yet.',
  'volume.removeConfirm': 'Remove this volume? Stored data may be lost.',
  // Managed databases
  'db.title': 'Databases',
  'db.new': 'New database',
  'db.name': 'Name',
  'db.engine': 'Engine',
  'db.version': 'Version',
  'db.dbName': 'Database name',
  'db.username': 'User',
  'db.create': 'Create database',
  'db.createHint':
    'Provision a managed database container on a node. Services can be attached after creation.',
  'db.creating': 'Provisioning…',
  'db.none': 'No databases yet.',
  'db.host': 'Host',
  'db.port': 'Port',
  'db.connection': 'Connection',
  'db.reveal': 'Show credentials',
  'db.hide': 'Hide',
  'db.password': 'Password',
  'db.url': 'Connection URL',
  'db.attach': 'Attach to service',
  'db.attachConfirm':
    'Attach this database to the selected service? Connection environment variables will be written.',
  'db.attachHint': 'Injects DATABASE_URL + DB_* env vars. Applied on the service’s next deploy.',
  'db.attached': 'Attached',
  'db.selectService': 'Select a service…',
  'db.deleteConfirm': 'Delete this database?',
  'db.startConfirm': 'Start this database container?',
  'db.stopConfirm':
    'Stop this database container? Connected services may fail until it is started again.',
  'db.keepVolume': 'Keep data volume',
  'db.keepVolumeTitle': 'Keep database volume?',
  'db.keepVolumeConfirm': 'Keep volume',
  'db.copy': 'Copy',
  'db.copied': 'Copied',
  'db.internalNote': 'Reachable from your services inside the network at this host.',
  // Backups
  'backup.title': 'Backups',
  'backup.now': 'Backup now',
  'backup.running': 'Backing up…',
  'backup.none': 'No backups yet.',
  'backup.download': 'Download',
  'backup.restore': 'Restore',
  'backup.restoring': 'Restoring…',
  'backup.restoreConfirm':
    'Restore this backup? Current data will be overwritten.',
  'backup.restoreDone': 'Restore complete.',
  'backup.delete': 'Delete',
  'backup.deleteConfirm': 'Delete this backup file?',
  'backup.size': 'Size',
  'backup.failed': 'Failed',
  'backup.schedule': 'Schedule',
  'backup.schedules': 'Schedules',
  'backup.cron': 'Cron (e.g. 0 3 * * *)',
  'backup.keepLast': 'Keep last',
  'backup.addSchedule': 'Add schedule',
  'backup.noSchedules': 'No schedules.',
  'backup.scheduleHint':
    'Runs automatically. Older backups beyond “keep last” are pruned.',
  'service.metrics': 'Metrics',
  'metrics.cpu': 'CPU',
  'metrics.memory': 'Memory',
  'metrics.network': 'Network I/O',
  'metrics.pids': 'PIDs',
  'metrics.health': 'Health',
  'metrics.notRunning': 'Container is not running.',

  // Tunnels / exposure
  'tunnel.title': 'Exposure',
  'tunnel.subtitle':
    'Expose this panel through a lightweight public VDS relay. The VDS only forwards traffic to your local proxy — no Docker, no per-app config.',
  'tunnel.lockedTitle': 'Reverse tunnels are a paid module',
  'tunnel.lockedBody':
    'Expose NAT / home-lab nodes to the internet through a public relay — the killer feature for self-hosting behind a grey IP. Unlock it with the Home-Lab plan (or Pro).',
  'tunnel.aboutTitle': 'What is a reverse tunnel?',
  'tunnel.aboutBody':
    'If your node sits behind a grey/NAT IP, it isn’t reachable from the internet. A reverse tunnel fixes this: a small client on your side connects out to a tunnel server on a cheap public VDS, which relays public ports (like 443) back to your Traefik. Visitors hit the VDS; traffic is forwarded to your node.',
  'tunnel.step1Title': 'Register the tunnel',
  'tunnel.step1Body':
    'Enter the VDS host, the control port and which ports to relay (usually 443). Point the target to your local proxy.',
  'tunnel.step2Title': 'Install the client',
  'tunnel.step2Body':
    'Use “Install” to get a one-line command. Run it on the VDS (server) and start the client on your side.',
  'tunnel.step3Title': 'Start & point DNS',
  'tunnel.step3Body':
    'Start the tunnel, then point your domain’s A record to the VDS IP. Status turns “Online” once connected.',
  'tunnel.add': 'Add tunnel',
  'tunnel.adding': 'Adding…',
  'tunnel.empty': 'No tunnels yet. Add one to expose this panel via a public VDS.',
  'tunnel.limitHint': '{count} of {max} tunnels used on your plan.',
  'tunnel.limitReached': 'Your plan allows at most {max} tunnel(s).',
  'tunnel.limitUpgrade': 'Upgrade for more.',
  'tunnel.namePlaceholder': 'Name (e.g. home → vds)',
  'tunnel.serverHostPlaceholder': 'Public VDS host or IP',
  'tunnel.controlPortPlaceholder': 'Control port',
  'tunnel.relayPortsPlaceholder': 'Relay ports (e.g. 443 or 443,80)',
  'tunnel.targetHostPlaceholder': 'Local target host',
  'tunnel.nameLabel': 'Name',
  'tunnel.serverHostLabel': 'Public VDS host / IP',
  'tunnel.controlPortLabel': 'Control port',
  'tunnel.relayPortsLabel': 'Relay ports',
  'tunnel.targetHostLabel': 'Local target host',
  'tunnel.proxyProtocol': 'PROXY protocol (preserve client IP)',
  'tunnel.start': 'Start',
  'tunnel.stop': 'Stop',
  'tunnel.connected': 'Connected',
  'tunnel.disconnected': 'Disconnected',
  'tunnel.install': 'Setup VDS',
  'tunnel.installTitle': 'Install on the public VDS',
  'tunnel.installHint':
    'Run ONE of these on your public VDS (white IP). It downloads the relay and starts it as a service. The token is embedded — keep it secret.',
  'tunnel.linux': 'Linux (systemd)',
  'tunnel.windows': 'Windows (admin PowerShell)',
  'tunnel.token': 'Token',
  'tunnel.copy': 'Copy',
  'tunnel.copied': 'Copied',
  'tunnel.offlineTitle': 'Panel on a grey IP? (offline via scp)',
  'tunnel.offlineHint':
    'If your panel is on a private/grey IP, the VDS can’t download from it. Run step 1 on the panel host, then copy the files to the VDS and launch the installer.',
  'tunnel.offlineStep1': '1. On the panel host — download relay + script',
  'tunnel.offlineStep2': '2. On the panel host — copy to the VDS (scp)',
  'tunnel.offlineStep3': '3. Install on the VDS (over ssh)',
  'tunnel.relayingTo': 'Relaying to',
  'tunnel.disabledHint':
    'Local tunnel control is disabled. Set LOCAL_AGENT_ENABLED=1 to run the client from the panel.',
  'tunnel.log': 'Log',
  'tunnel.hideLog': 'Hide log',
  'tunnel.startConfirm': 'Start this tunnel?',
  'tunnel.stopConfirm':
    'Stop this tunnel? Public traffic through the relay will stop.',
  'tunnel.confirmDelete': 'Delete this tunnel?',
  'tunnel.dnsHint':
    'DNS: A example.com and A *.example.com → VDS IP (ports 80/443 via tunnel). TLS on local Traefik: HTTP-01 per subdomain (default) or ACME_WILDCARD_CERTS=1 + Cloudflare token for a *.example.com cert.',

  // Service / deployment statuses
  'status.RUNNING': 'Running',
  'status.SUCCESS': 'Success',
  'status.ONLINE': 'Online',
  'status.BUILDING': 'Building',
  'status.DEPLOYING': 'Deploying',
  'status.QUEUED': 'Queued',
  'status.CREATED': 'Created',
  'status.STOPPED': 'Stopped',
  'status.OFFLINE': 'Offline',
  'status.ERROR': 'Error',
  'status.FAILED': 'Failed',

  // Service types
  'type.BACKEND': 'Backend',
  'type.FRONTEND': 'Frontend',

  // Billing / licensing
  'billing.subtitle':
    'Manage this installation’s plan. The free core is unlimited; paid plans unlock add-on modules.',
  'billing.currentPlan': 'Current plan',
  'billing.active': 'Active',
  'billing.free': 'Free',
  'billing.inactive': 'Inactive',
  'billing.expires': 'Expires',
  'billing.perpetual': 'Never (perpetual)',
  'billing.expiresSoon': 'Expires in {days} days — renew to keep paid features.',
  'billing.activation.online': 'Activated online',
  'billing.activation.offline': 'Awaiting activation — paid modules are locked until the license server is reachable',
  'billing.activation.lastCheck': 'last check',
  'billing.unlockedModules': 'Unlocked modules',
  'billing.noModules': 'Core features only',
  'billing.licenseKey': 'License key',
  'billing.licenseKeyHint':
    'Paste the license key from your purchase confirmation to activate a paid plan on this installation.',
  'billing.licenseKeyPlaceholder': 'paste license key…',
  'billing.activate': 'Activate license',
  'billing.activating': 'Activating…',
  'billing.remove': 'Remove license',
  'billing.activated': 'License activated.',
  'billing.removed': 'License removed. Reverted to Free.',
  'billing.adminOnly':
    'Only an administrator can activate or change the license key.',
  'billing.plansTitle': 'Plans',
  'billing.yourPlan': 'Your plan',
  'billing.buy': 'Get started',
  'billing.viewPlans': 'View plans',
  'billing.requiresPlan': 'Requires the {plan} plan',
  'billing.forever': 'forever',
  'billing.perMonth': '/mo',
  'billing.price.free': '$0',
  'billing.price.homelab': '$3',
  'billing.price.pro': '$15',
  'billing.tier.free': 'Free',
  'billing.tier.homelab': 'Home-Lab',
  'billing.tier.pro': 'Pro',
  // Free tier — the core PaaS, no license required.
  'billing.feat.free.deploy.title': 'Deploy from Git, templates & Docker',
  'billing.feat.free.deploy.desc':
    'Push-to-deploy any repository, launch from one-click app templates, or run any Docker image — no manual server wiring.',
  'billing.feat.free.https.title': 'Automatic HTTPS',
  'billing.feat.free.https.desc':
    'Traefik issues and renews Let’s Encrypt certificates per subdomain, so every service is served over TLS out of the box.',
  'billing.feat.free.databases.title': 'Managed databases',
  'billing.feat.free.databases.desc':
    'Spin up PostgreSQL or MySQL per project, with scheduled backups and one-click restore.',
  'billing.feat.free.observability.title': 'Logs & live metrics',
  'billing.feat.free.observability.desc':
    'Stream container logs and watch real-time CPU, RAM and disk usage for every service and node.',
  'billing.feat.free.access.title': 'Projects, RBAC & 2FA',
  'billing.feat.free.access.desc':
    'Organize work into projects, control who can do what with roles, and protect accounts with two-factor auth.',
  'billing.feat.free.node.title': '1 node included',
  'billing.feat.free.node.desc':
    'Run the whole platform on a single server — perfect for a personal project or a trial.',
  // Home-Lab tier — Free core plus reverse tunnels.
  'billing.feat.homelab.allFree.title': 'Everything in Free',
  'billing.feat.homelab.allFree.desc':
    'The complete free core, plus the home-lab additions below.',
  'billing.feat.homelab.tunnels.title': 'Secure reverse tunnels',
  'billing.feat.homelab.limits.title': '3 nodes + 3 tunnels',
  'billing.feat.homelab.limits.desc':
    'Connect up to three servers and publish up to three tunneled services — enough for a real multi-machine home lab.',
  // Pro tier — everything, unlimited, all modules.
  'billing.feat.pro.allHomelab.title': 'Everything in Free & Home-Lab',
  'billing.feat.pro.allHomelab.desc':
    'The full free core and reverse tunnels, plus every add-on module below.',
  'billing.feat.pro.unlimited.title': 'Unlimited nodes & tunnels',
  'billing.feat.pro.unlimited.desc':
    'Scale across as many servers and expose as many services as you need — no caps.',
  'billing.proModulesTitle': 'Every Pro module',
  // Per-module value propositions (what it does + why it matters).
  'billing.moduleDesc.reverse-tunnels':
    'Publish services behind NAT or a home/LAN network to the internet through a lightweight public relay — no port-forwarding, static IP or router changes needed.',
  'billing.moduleDesc.preview-envs':
    'Deploy any branch as a disposable, isolated copy with its own optional subdomain, auto-torn down by TTL — review changes safely before they ship.',
  'billing.moduleDesc.offsite-backups':
    'Mirror managed-database backups to any S3-compatible bucket with encrypted credentials, so your data survives even if a node is lost.',
  'billing.moduleDesc.alerts':
    'Send webhook alerts (Slack, Discord, Telegram, custom) for node-offline, failed deploys or backups and resource thresholds — hear about incidents before your users do.',
  'billing.moduleDesc.metrics-history':
    'Continuously sample and store per-node CPU, RAM and disk usage, with history charts for capacity planning and troubleshooting.',
  'billing.moduleDesc.sso':
    'Let your team sign in with your identity provider over OpenID Connect, with a domain allow-list and just-in-time user provisioning.',
  'billing.moduleDesc.audit-export':
    'Review an organization-wide activity trail and export it as CSV or JSON for compliance and incident investigations.',
  'billing.moduleDesc.api-cli':
    'Issue personal access tokens to automate the platform from scripts, CI/CD pipelines and the CLI.',
  'billing.moduleDesc.white-label':
    'Rebrand the panel with your own app name, logo, accent color and attribution across the UI and login page.',
  'billing.moduleDesc.email':
    'Connect your SMTP provider to send transactional and broadcast email from the panel — configure the sender identity, send test messages, notify all users or specific recipients, and review a delivery log.',
  'billing.module.reverse-tunnels': 'Reverse-tunnels',
  'billing.module.preview-envs': 'Preview environments',
  'billing.module.offsite-backups': 'Off-site backups',
  'billing.module.alerts': 'Alerts',
  'billing.module.metrics-history': 'Metrics history',
  'billing.module.sso': 'SSO / OIDC',
  'billing.module.audit-export': 'Audit export',

  // Audit log page (Pro: audit-export)
  'audit.subtitle': 'Organization-wide activity trail with CSV/JSON export.',
  'audit.lockedTitle': 'Audit export is a Pro module',
  'audit.lockedBody':
    'View the organization-wide activity trail and export it as CSV or JSON for compliance and incident review. Upgrade to Pro to unlock it.',
  'audit.adminOnly': 'The audit log is available to administrators only.',
  'audit.exportTitle': 'Export',
  'audit.exportHint':
    'Download the audit trail. Optionally narrow it by action prefix and date range.',
  'audit.filterAction': 'Action prefix',
  'audit.filterActionPlaceholder': 'e.g. services. or auth.',
  'audit.filterFrom': 'From',
  'audit.filterTo': 'To',
  'audit.exportCsv': 'Export CSV',
  'audit.exportJson': 'Export JSON',
  'audit.exporting': 'Exporting…',
  'audit.recentTitle': 'Recent activity',
  'audit.colTime': 'Time',
  'audit.colUser': 'User',
  'audit.colAction': 'Action',
  'audit.colTarget': 'Target',
  'audit.colIp': 'IP',
  'audit.colStatus': 'Status',
  'billing.module.api-cli': 'API & CLI',
  'billing.module.white-label': 'White-label',
  'billing.module.email': 'Email service',

  // Alerts (Pro: alerts)
  'alerts.title': 'Alerts',
  'alerts.subtitle':
    'Get notified about node, deploy, service, database, backup and tunnel incidents.',
  'alerts.lockedTitle': 'Alerts is a Pro feature',
  'alerts.lockedBody':
    'Wire monitored events to webhook channels (Slack, Discord, Telegram, custom) and get notified automatically.',
  'alerts.adminOnly': 'Only administrators can manage alerts.',
  'alerts.channelsTitle': 'Channels',
  'alerts.channelsHint':
    'A destination for notifications. Any endpoint that accepts a JSON POST works (Slack/Discord/Mattermost incoming webhooks, n8n, custom).',
  'alerts.channelName': 'Name',
  'alerts.channelNamePlaceholder': 'e.g. Ops Slack',
  'alerts.channelUrl': 'Webhook URL',
  'alerts.channelUrlPlaceholder': 'https://hooks.slack.com/services/…',
  'alerts.addChannel': 'Add channel',
  'alerts.noChannels': 'No channels yet.',
  'alerts.test': 'Test',
  'alerts.testOk': 'Sent ✓',
  'alerts.enable': 'Enable',
  'alerts.disable': 'Disable',
  'alerts.delete': 'Delete',
  'alerts.enabled': 'Enabled',
  'alerts.disabled': 'Disabled',
  'alerts.confirmDeleteChannel':
    'Delete this channel? Rules using it will be removed too.',
  'alerts.rulesTitle': 'Rules',
  'alerts.rulesHint': 'Send a channel a notification when an event fires.',
  'alerts.ruleName': 'Name',
  'alerts.ruleNamePlaceholder': 'e.g. Node down → Slack',
  'alerts.event': 'Event',
  'alerts.channel': 'Channel',
  'alerts.selectChannel': 'Select a channel…',
  'alerts.addRule': 'Add rule',
  'alerts.noRules': 'No rules yet.',
  'alerts.needChannelFirst': 'Add a channel first to create rules.',
  'alerts.confirmDeleteRule': 'Delete this rule?',
  // Event category groups (rule picker).
  'alerts.grp.nodes': 'Nodes',
  'alerts.grp.deployments': 'Deployments',
  'alerts.grp.services': 'Services',
  'alerts.grp.databases': 'Databases',
  'alerts.grp.backups': 'Backups',
  'alerts.grp.networking': 'Networking',
  'alerts.grp.licensing': 'Licensing',
  // Event labels.
  'alerts.ev.nodeOffline': 'Node offline',
  'alerts.ev.nodeOnline': 'Node recovered',
  'alerts.ev.nodeCpuHigh': 'Node CPU high',
  'alerts.ev.nodeMemHigh': 'Node memory high',
  'alerts.ev.nodeDiskHigh': 'Node disk high',
  'alerts.ev.deployFailed': 'Deploy failed',
  'alerts.ev.deploySucceeded': 'Deploy succeeded',
  'alerts.ev.deployStuck': 'Deploy stuck',
  'alerts.ev.serviceError': 'Service error',
  'alerts.ev.serviceStopped': 'Service stopped',
  'alerts.ev.databaseError': 'Database error',
  'alerts.ev.databaseStopped': 'Database stopped',
  'alerts.ev.backupFailed': 'Backup failed',
  'alerts.ev.backupSucceeded': 'Backup succeeded',
  'alerts.ev.offsiteFailed': 'Off-site upload failed',
  'alerts.ev.tunnelOffline': 'Tunnel down',
  'alerts.ev.tunnelOnline': 'Tunnel recovered',
  'alerts.ev.licenseExpiring': 'License expiring',
  'alerts.eventsTitle': 'Recent alerts',
  'alerts.noEvents': 'No alerts have fired yet.',
  'alerts.colTime': 'Time',
  'alerts.colEvent': 'Event',
  'alerts.colTitle': 'Alert',
  'alerts.colStatus': 'Delivery',
  'alerts.statusSent': 'Sent',
  'alerts.statusFailed': 'Failed',

  // Offsite backups (Pro: offsite-backups)
  'offsite.title': 'Offsite backups',
  'offsite.subtitle': 'Mirror your local backups to an S3-compatible bucket.',
  'offsite.lockedTitle': 'Offsite backups is a Pro feature',
  'offsite.lockedBody':
    'Automatically copy every successful backup to an off-site S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, Backblaze B2).',
  'offsite.adminOnly': 'Only administrators can manage offsite backups.',
  'offsite.destTitle': 'S3 destination',
  'offsite.destHint':
    'Successful backups are uploaded automatically on a schedule. Works with any S3-compatible storage.',
  'offsite.enabled': 'Enabled',
  'offsite.endpoint': 'Endpoint',
  'offsite.region': 'Region',
  'offsite.bucket': 'Bucket',
  'offsite.prefix': 'Key prefix (optional)',
  'offsite.accessKeyId': 'Access key ID',
  'offsite.secretKey': 'Secret access key',
  'offsite.forcePathStyle': 'Force path-style addressing (MinIO and most non-AWS)',
  'offsite.save': 'Save',
  'offsite.saving': 'Saving…',
  'offsite.saved': 'Destination saved.',
  'offsite.test': 'Test connection',
  'offsite.testing': 'Testing…',
  'offsite.testOk': 'Connection OK — bucket is writable.',
  'offsite.syncNow': 'Sync now',
  'offsite.syncing': 'Syncing…',
  'offsite.syncResult': 'Sync done: {uploaded} uploaded, {failed} failed.',
  'offsite.uploadsTitle': 'Recent uploads',
  'offsite.noUploads': 'Nothing uploaded yet.',
  'offsite.colTime': 'Time',
  'offsite.colKey': 'Object key',
  'offsite.colSize': 'Size',
  'offsite.colStatus': 'Status',
  'offsite.statusUploaded': 'Uploaded',
  'offsite.statusFailed': 'Failed',

  // Personal API tokens (Pro: api-cli)
  'apiTokens.title': 'API tokens',
  'apiTokens.subtitle': 'Personal tokens for the API and CLI.',
  'apiTokens.lockedTitle': 'API & CLI access is a Pro feature',
  'apiTokens.lockedBody':
    'Create personal access tokens to script the panel or use it from CI/CD. Tokens carry your own permissions.',
  'apiTokens.createTitle': 'Create a token',
  'apiTokens.name': 'Name',
  'apiTokens.namePlaceholder': 'e.g. CI pipeline',
  'apiTokens.expiry': 'Expires in (days)',
  'apiTokens.expiryPlaceholder': 'never',
  'apiTokens.create': 'Create token',
  'apiTokens.freshTitle': 'Copy your new token now',
  'apiTokens.freshHint':
    "This is the only time the token is shown. Store it somewhere safe — you won't be able to see it again.",
  'apiTokens.copy': 'Copy',
  'apiTokens.copied': 'Copied ✓',
  'apiTokens.usageTitle': 'Using the token',
  'apiTokens.usageHint':
    'Send it as a Bearer token in the Authorization header:',
  'apiTokens.listTitle': 'Your tokens',
  'apiTokens.empty': 'No tokens yet.',
  'apiTokens.created': 'created',
  'apiTokens.lastUsed': 'last used',
  'apiTokens.neverUsed': 'never used',
  'apiTokens.expires': 'expires',
  'apiTokens.revoke': 'Revoke',
  'apiTokens.confirmRevoke':
    'Revoke this token? Any script using it will stop working.',

  // White-label (Pro: white-label)
  'brand.poweredBy': 'Powered by Self-Hosted',
  'whiteLabel.title': 'White-label',
  'whiteLabel.subtitle': 'Rebrand the panel with your own name, logo and colour.',
  'whiteLabel.lockedTitle': 'White-label is a Pro feature',
  'whiteLabel.lockedBody':
    'Replace the app name, logo and accent colour, and remove the “Powered by” attribution.',
  'whiteLabel.adminOnly': 'Only administrators can change branding.',
  'whiteLabel.appName': 'App name',
  'whiteLabel.accentColor': 'Accent colour',
  'whiteLabel.logoUrl': 'Logo URL',
  'whiteLabel.hidePoweredBy': 'Hide “Powered by” attribution',
  'whiteLabel.preview': 'Preview',
  'whiteLabel.save': 'Save branding',
  'whiteLabel.saving': 'Saving…',
  'whiteLabel.saved': 'Branding saved and applied.',
  'whiteLabel.reloadHint':
    'Name, logo, favicon and accent colour apply across the app right away.',

  // Metrics history (Pro: metrics-history)
  'metricsHistory.title': 'Metrics',
  'metricsHistory.subtitle': 'Historical CPU, memory and disk usage per node.',
  'metricsHistory.lockedTitle': 'Metrics history is a Pro feature',
  'metricsHistory.lockedBody':
    'Collect and chart CPU, memory and disk usage over time for every node.',
  'metricsHistory.empty':
    'No data yet — the first sample is collected within about a minute.',
  'metricsHistory.collecting':
    'Collecting… the chart appears once there are a couple of samples.',
  'metricsHistory.cpu': 'CPU',
  'metricsHistory.mem': 'Memory',
  'metricsHistory.disk': 'Disk',

  // Section explainers (GuideCard) shown at the top of feature pages
  'alerts.aboutTitle': 'What are alerts?',
  'alerts.aboutBody':
    'Get notified when something needs attention — a node goes offline, a deploy fails, a backup breaks and more. Create a channel (a webhook URL for Slack, Telegram, Discord, etc.), then add rules that route specific events to it.',
  'audit.aboutTitle': 'What is the audit log?',
  'audit.aboutBody':
    'A record of who did what across your organization — logins, deploys, config changes and more. Filter by action or date range and export the full history as CSV or JSON for compliance or investigations.',
  'metricsHistory.aboutTitle': 'What is metrics history?',
  'metricsHistory.aboutBody':
    'Historical CPU, memory and disk usage per node, sampled continuously so you can spot trends, capacity limits and regressions over time. Pick a node and a time range to inspect its charts.',
  'offsite.aboutTitle': 'What are offsite backups?',
  'offsite.aboutBody':
    'Mirror local backups to S3-compatible storage (AWS S3, Backblaze B2, Wasabi, MinIO…) so a copy survives even if the server is lost. Enter your bucket and credentials, test the connection, then sync on demand.',
  'apiTokens.aboutTitle': 'What are API tokens?',
  'apiTokens.aboutBody':
    'Long-lived tokens for scripting the panel from the CLI or CI/CD without your password or 2FA. Create a token, copy it once (it is shown only at creation) and send it as a Bearer header. Revoke any token anytime.',
  'whiteLabel.aboutTitle': 'What is white-labeling?',
  'whiteLabel.aboutBody':
    'Make the panel your own: set the app name, logo and accent color, and optionally hide the “powered by” note. Changes apply instantly to the header, browser tab and favicon across the app.',
  'sso.aboutTitle': 'What is single sign-on?',
  'sso.aboutBody':
    'Let your team sign in with an existing identity provider (Google, Microsoft Entra, Okta, Keycloak — any OpenID Connect). Register the redirect URI at your provider, paste the issuer and client credentials, then enable SSO.',
  'previews.aboutTitle': 'What are preview environments?',
  'previews.aboutBody':
    'Spin up a temporary, isolated deployment of a service from any git branch — ideal for reviewing a pull request on its own URL. Each preview auto-expires after its TTL and can be redeployed or removed anytime.',
  'email.aboutTitle': 'What is the email service?',
  'email.aboutBody':
    'Send and broadcast messages to your users through your own SMTP provider (Mailgun, SendGrid, Amazon SES, Postmark, or any SMTP relay). This is outbound only — it relays mail through a provider you configure; it is not an inbound mail server. Enter your SMTP settings, send a test, then compose a message to all users or a specific list.',

  // Email service (Pro: email)
  'email.title': 'Email',
  'email.subtitle': 'Send and broadcast messages to your users over SMTP.',
  'email.lockedTitle': 'Email is a Pro feature',
  'email.lockedBody':
    'Connect an SMTP provider to send transactional mail and broadcast announcements to your users and team.',
  'email.adminOnly': 'Only administrators can configure and send email.',
  'email.smtpTitle': 'SMTP settings',
  'email.smtpHint':
    'Use credentials from your email provider (Mailgun, SendGrid, Amazon SES, Postmark, or any SMTP relay).',
  'email.enabled': 'Enabled',
  'email.host': 'SMTP host',
  'email.port': 'Port',
  'email.secure': 'Use implicit TLS (port 465). Leave off for STARTTLS (587).',
  'email.username': 'Username',
  'email.password': 'Password',
  'email.fromName': 'From name',
  'email.fromEmail': 'From address',
  'email.save': 'Save',
  'email.saving': 'Saving…',
  'email.saved': 'Email settings saved.',
  'email.testTo': 'Test recipient (optional)',
  'email.test': 'Send test',
  'email.testing': 'Sending…',
  'email.testOk': 'Test email sent to {to}.',
  'email.composeTitle': 'Compose message',
  'email.composeHint':
    'Recipients are hidden from one another (sent via BCC).',
  'email.subject': 'Subject',
  'email.body': 'Message',
  'email.recipients': 'Recipients',
  'email.recipientsAll': 'All users',
  'email.recipientsCustom': 'Specific addresses',
  'email.recipientsList': 'Addresses (comma or newline separated)',
  'email.send': 'Send message',
  'email.sending': 'Sending…',
  'email.sendOk': 'Message sent to {count} recipient(s).',
  'email.historyTitle': 'Delivery history',
  'email.noHistory': 'No messages sent yet.',
  'email.colTime': 'Time',
  'email.colSubject': 'Subject',
  'email.colRecipients': 'Recipients',
  'email.colStatus': 'Status',
  'email.statusSent': 'Sent',
  'email.statusFailed': 'Failed',

  // Single sign-on (Pro: sso)
  'sso.title': 'Single sign-on',
  'sso.subtitle': 'Let users sign in with your OpenID Connect identity provider.',
  'sso.lockedTitle': 'Single sign-on is a Pro feature',
  'sso.lockedBody':
    'Connect Google, Microsoft Entra, Okta, Keycloak or any OpenID Connect provider so your team signs in with their existing accounts.',
  'sso.adminOnly': 'Only administrators can configure single sign-on.',
  'sso.enabled': 'Enable single sign-on',
  'sso.enabledHint':
    'When enabled and configured, a sign-in button appears on the login page.',
  'sso.issuer': 'Issuer URL',
  'sso.clientId': 'Client ID',
  'sso.clientSecret': 'Client secret',
  'sso.clientSecretSet': 'Client secret (leave blank to keep current)',
  'sso.allowedDomains': 'Allowed email domains (optional)',
  'sso.autoCreate': 'Create accounts on first sign-in',
  'sso.buttonLabel': 'Sign-in button label',
  'sso.redirectUri': 'Redirect URI',
  'sso.redirectUriHint':
    'Register this exact URL as an allowed redirect URI at your identity provider.',
  'sso.save': 'Save',
  'sso.saving': 'Saving…',
  'sso.saved': 'Single sign-on settings saved.',
  'sso.signingIn': 'Signing you in…',
  'sso.error.title': 'Sign-in failed',
  'sso.error.backToLogin': 'Back to login',
  'sso.error.invalid_request': 'The sign-in request was incomplete. Please try again.',
  'sso.error.not_licensed': 'Single sign-on requires the Pro plan.',
  'sso.error.not_configured': 'Single sign-on is not configured.',
  'sso.error.bad_state':
    'The sign-in link expired or was invalid. Please try again.',
  'sso.error.no_email': 'Your identity provider did not share an email address.',
  'sso.error.email_unverified':
    'Your email address is not verified with the identity provider.',
  'sso.error.domain_not_allowed':
    'Your email domain is not allowed to sign in here.',
  'sso.error.no_account':
    'No account exists for your email, and automatic account creation is off.',
  'sso.error.access_denied': 'Access was denied by the identity provider.',
  'sso.error.sso_failed': 'Single sign-on failed. Please try again.',

  // Preview environments (Pro: preview-envs)
  'previews.title': 'Preview environments',
  'previews.subtitle':
    'Spin up a disposable copy of a service from any branch, with its own URL.',
  'previews.lockedTitle': 'Preview environments are a Pro feature',
  'previews.lockedBody':
    'Deploy any branch as an isolated, auto-expiring environment with its own subdomain — perfect for reviewing pull requests.',
  'previews.newTitle': 'New preview',
  'previews.service': 'Service',
  'previews.servicePlaceholder': 'Select a service…',
  'previews.branch': 'Branch',
  'previews.host': 'Public host (optional)',
  'previews.hostHint':
    'A subdomain to route to this preview. Leave blank for internal-only.',
  'previews.ttl': 'Auto-expire (hours)',
  'previews.ttlHint': 'Torn down automatically after this many hours. 0 = never.',
  'previews.create': 'Create preview',
  'previews.creating': 'Creating…',
  'previews.empty': 'No preview environments yet.',
  'previews.confirmDelete':
    'Delete this preview environment? Its container and image will be removed.',
  'previews.internalOnly': 'Internal only',
  'previews.expires': 'Expires',
  'previews.never': 'Never',
  'previews.open': 'Open',
  'previews.redeploy': 'Redeploy',
  'previews.delete': 'Delete',
};
