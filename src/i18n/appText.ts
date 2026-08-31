export type AnoteLanguage = 'en' | 'es';

const english = {
    common: {
        anote: 'Anote',
        actions: 'Actions',
        add: 'Add',
        administration: 'Administration',
        back: 'Back',
        backToCalendar: 'Back to calendar',
        cancel: 'Cancel',
        close: 'Close',
        color: 'Color',
        confirm: 'Confirm',
        copy: 'Copy',
        create: 'Create',
        date: 'Date',
        delete: 'Delete',
        deleting: 'Deleting…',
        deselect: 'Deselect',
        disabled: 'Disabled',
        edit: 'Edit',
        enabled: 'Enabled',
        event: 'Event',
        events: 'Events',
        hour: 'Hour',
        language: 'Language',
        link: 'Link',
        loading: 'Loading…',
        move: 'Move',
        all: 'All',
        none: 'None',
        next: 'Next',
        noEvents: 'No events yet.',
        note: 'Note',
        order: 'Order',
        previous: 'Previous',
        priority: 'Priority',
        readOnly: 'Read-only',
        remove: 'Remove',
        reset: 'Reset',
        role: 'Role',
        save: 'Save',
        saveChanges: 'Save changes',
        saving: 'Saving…',
        select: 'Select',
        selectAll: 'Select all',
        selected: 'Selected',
        spanish: 'Spanish',
        english: 'English',
        time: 'Time',
        title: 'Title',
        update: 'Update',
        user: 'User',
        users: 'Users',
        view: 'View'
    },
    auth: {
        subtitle: 'Your plans and notes, kept together',
        username: 'Username',
        usernamePlaceholder: 'Enter your username',
        password: 'Password',
        passwordHint: 'Use at least 12 characters.',
        signIn: 'Sign in',
        signingIn: 'Signing in…',
        register: 'Create account',
        registering: 'Creating account…',
        createAccountPrompt: 'Need an account? Create one',
        signInPrompt: 'Already have an account? Sign in'
    },
    shell: {
        openUserMenu: 'Open user menu',
        profile: 'Profile',
        friends: 'Friends',
        roles: 'Roles',
        programs: 'Programs',
        administration: 'Administration',
        myCalendar: 'My calendar',
        postponedEvents: 'Postponed events',
        signOut: 'Sign out',
        friendFallback: 'Friend',
        backToFriends: 'Back to friends',
        backToCalendar: 'Back to my calendar',
        viewingFriend: "You are viewing {name}'s calendar. Changes are not available here.",
        viewingOwn: 'Viewing my calendar',
        calendarSystem: 'ANOTE CALENDAR',
        calendarTitle: 'PLAN AND NOTE',
        defaultSubtitle: 'Mark progress, move plans, and keep your calendar notes in one place.',
        defaultConsoleTitle: 'Anote Console'
    },
    admin: {
        eyebrow: 'SYSTEM SETTINGS',
        title: 'Administration',
        configuration: 'Configuration',
        configurationDescription: 'Manage the Anote name and calendar introduction.',
        applicationTitle: 'Application title',
        consoleTitle: 'Calendar label',
        subtitle: 'Subtitle',
        live: 'LIVE',
        livePreview: 'Preview',
        subtitlePreview: 'Subtitle description…',
        eventManagement: 'Event management',
        eventManagementDescription: 'Review and remove calendar events.',
        userManagement: 'User management',
        userManagementDescription: 'Review and remove registered users.',
        roleRecords: 'Role records',
        roleRecordsDescription: 'Review role labels and ordering. Private note content remains visible only to its owner.',
        rolesTable: 'Roles',
        records: 'records',
        noTableData: 'No records in {table}.',
        allUsers: 'All users',
        administrator: 'Administrator',
        standardUser: 'User',
        eventCount: '{count} events',
        noAdminEvents: 'No events found.',
        noAdminUsers: 'No users found.',
        editUnavailable: 'Event editing is not available from this view yet.',
        applicationTitleRequired: 'Enter an application title.',
        configurationSaved: 'Configuration saved.',
        configurationSaveFailed: 'The configuration could not be saved.',
        configurationReset: 'Unsaved configuration changes were reset.',
        bulkDeleteTitle: 'Delete selected {items}?',
        bulkDeleteDescription: '{count} {items} will be permanently deleted. This cannot be undone.',
        bulkDeleteSuccess: 'Deleted {count} {items}.',
        bulkDeleteFailed: 'The selected {items} could not be deleted.',
        deleteEventTitle: 'Delete event?',
        deleteEventDescription: '“{name}” will be permanently deleted.',
        deleteUserTitle: 'Delete user?',
        deleteUserDescription: 'The account for {name} and its owned data will be permanently deleted.',
        deleteSelection: 'Delete selection',
        eventsLower: 'events',
        usersLower: 'users',
        selectAllEvents: 'Select all events',
        selectAllUsers: 'Select all users',
        selectEvent: 'Select event {name}',
        selectUser: 'Select user {name}',
        deleteEvent: 'Delete event {name}',
        deleteUser: 'Delete user {name}'
    },
    calendar: {
        system: 'ANOTE CALENDAR',
        monthView: 'Calendar',
        monthCoordinates: 'Month controls',
        compare: 'Compare',
        matches: 'Matches',
        postponedEvents: 'Postponed events',
        readEvents: 'Read events',
        inputEvents: 'Add events',
        shareEvents: 'Share events',
        sharing: 'Sharing…',
        eventsFor: 'Events for {date}',
        shareEventsFor: 'Share events for {date}',
        openEventLink: 'Open link for {name}',
        moveEvents: 'Move events',
        selectDays: 'Select days',
        markDays: 'Mark days ({count})',
        publishEvents: 'Publish events',
        publishing: 'Publishing…',
        moving: 'Moving…',
        moveFromDay: 'Move from {count} day',
        moveFromDays: 'Move from {count} days',
        selectedDay: '{count} selected day',
        selectedDays: '{count} selected days',
        queuedEvent: '{count} queued event',
        queuedEvents: '{count} queued events',
        selectedFriend: '{count} selected friend',
        selectedFriends: '{count} selected friends',
        target: 'Target',
        cancelOperation: 'Cancel the current operation',
        moveIncompleteTo: 'Move incomplete events to {date}',
        awaitingSelection: 'Select days in the calendar to continue.',
        sector: 'DAY',
        marked: 'SELECTED',
        ghostDay: 'This day belongs to another month.',
        selectedDayLabel: 'Selected day',
        dayAdministration: 'Day administration',
        daySettings: 'Day settings',
        dayContextLabel: 'Day label',
        dayContextPlaceholder: 'For example, sprint planning',
        dayContextHelp: 'Add a short label to make this day easy to recognize.',
        backgroundImage: 'Background image',
        backgroundUrlPlaceholder: 'https://images.example.com/background.jpg',
        backgroundPreviewOpacity: 'Preview opacity',
        noBackground: 'No background image',
        saveDaySettings: 'Save day settings',
        eventsAdministration: 'Events administration',
        eventsAdministrationDescription: 'Organize events for {date}.',
        selectCalendarDay: 'Select a calendar day',
        openDayHelp: 'Open a day from the calendar to administer its events.',
        backToDay: 'Back to day',
        noEventsForDay: 'No events are scheduled for this day.',
        eventInformation: 'Event information',
        trackRecord: 'History',
        previouslyPostponed: 'Previously postponed',
        originalEntry: 'Original date: {date}',
        openDayAdministration: 'Open event administration for {date}',
        configureDay: 'Configure {date}',
        closeDay: 'Close day details',
        eventBoard: 'Events',
        createEvent: 'Create event',
        updateEvent: 'Update event',
        eventTitlePlaceholder: 'What do you want to remember?',
        priorityPlaceholder: 'Priority',
        linkPlaceholder: 'Optional link',
        notePlaceholder: 'Optional note',
        editEvent: 'Edit event {name}',
        deleteEvent: 'Delete event {name}',
        eventAdministration: 'Event administration',
        groupInput: 'Add events to selected days',
        addEvent: 'Add event',
        removeQueuedEvent: 'Remove queued event {name}',
        eventDistribution: 'Event distribution',
        selectedDayCount: '{current} of {total} days',
        selectedEventCount: '{current} of {total} events',
        selectedFriendCount: '{current} of {total} friends',
        noSelectedDays: 'Select at least one day to continue.',
        selectFriends: 'Select friends',
        noFriends: 'No friends are available.',
        selectEvents: 'Select events',
        unselectAll: 'Clear selection',
        selectIncomplete: 'Select unfinished',
        noShareableEvents: 'No events are available to share.',
        postponedVault: 'Events waiting for a new date',
        postponedEventBoard: 'Postponed events',
        todayView: 'Today',
        weekView: 'Week',
        allView: 'All',
        eventsManagement: 'Event management',
        window: 'Range',
        action: 'Action',
        postponedView: 'Postponed list',
        moveToPostponed: 'Move to postponed',
        copyToPostponed: 'Copy to postponed',
        source: 'Source',
        destination: 'Destination',
        chooseTarget: 'Choose a target date.',
        copySelected: 'Copy selected',
        moveSelected: 'Move selected',
        postponeSelected: 'Postpone selected',
        selectedEvent: '{count} selected event',
        selectedEvents: '{count} selected events'
    },
    social: {
        eyebrow: 'PEOPLE',
        title: 'Friends',
        description: 'View all Anote users and manage your own friend list. Friend calendars are read-only.',
        backToOwnCalendar: 'Back to {name}',
        friends: 'Friends',
        noFriends: 'No friends yet. Add someone from the directory.',
        viewCalendar: 'View {name} calendar',
        removeFriend: 'Remove {name} from friends',
        directory: 'All users',
        friend: 'Friend',
        addFriend: 'Add {name} as a friend',
        noOtherUsers: 'No other users found.'
    },
    profile: {
        eyebrow: 'PROFILE',
        title: 'Appearance',
        description: 'Personalize your calendar. These choices affect only your view; friend calendars remain read-only.',
        username: 'Username',
        backgroundImageUrl: 'Background image URL',
        backgroundHelp: 'Leave this empty to use the default gradient.',
        accent: 'Accent color',
        accentText: 'Accent color value',
        noiseOverlay: 'Add texture overlay',
        theme: 'Theme',
        light: 'Light',
        dark: 'Dark',
        themeHelp: 'Choose a light or night-friendly interface. The choice is saved to your profile.',
        reset: 'Reset appearance',
        save: 'Save preferences'
    },
    roles: {
        eyebrow: 'CALENDAR LABELS',
        title: 'Roles',
        description: 'Define the roles used in event notes and keep their order consistent across your calendar.',
        roles: 'Roles',
        rolesHelp: 'Use concise labels so collaborators can choose quickly.',
        addRole: 'Add role',
        noRoles: 'No roles have been defined.',
        moveRoleUp: 'Move {name} up',
        moveRoleDown: 'Move {name} down',
        renameRole: 'Rename role {name}',
        renameRoleTitle: 'Rename role',
        roleName: 'Role name',
        roleNameExample: 'For example, Reviewer',
        createRoleTitle: 'Create role',
        addSubrole: 'Add a subrole to {name}',
        createSubroleTitle: 'Create subrole for {name}',
        subroleName: 'Subrole name',
        renameSubrole: 'Rename subrole {name}',
        renameSubroleTitle: 'Rename subrole',
        deleteRole: 'Delete role {name}',
        deleteRoleTitle: 'Delete role?',
        deleteRoleDescription: '“{name}” and its subroles will be permanently deleted.',
        deleteSubrole: 'Delete subrole {name}',
        deleteSubroleTitle: 'Delete subrole?',
        deleteSubroleDescription: '“{name}” will be permanently deleted.',
        selectRole: 'Select role',
        noRolesAvailable: 'No roles are available.',
        subrolesFor: 'Subroles for {name}',
        noSubrolesAvailable: 'No subroles are available.'
    },
    notes: {
        closeEditor: 'Close note editor',
        savedAt: 'Saved at {time}',
        writeAs: 'Write your observations as {role}…',
        noPreview: 'There is no note content to preview.',
        attachments: 'Attachments',
        uploading: 'Uploading…',
        dropFiles: 'Drag files here',
        clickToUpload: 'or choose files',
        markdownSupported: 'Markdown formatting is supported',
        editMode: 'Edit note',
        previewMode: 'Preview note',
        attachFile: 'Attach files',
        insertLink: 'Insert link',
        saveNote: 'Save note',
        loadingText: 'Loading text preview…',
        textPreviewFailed: 'This text preview could not be loaded.',
        noInlinePreview: 'This file type cannot be previewed here.',
        uploadedFile: 'Uploaded file',
        preview: 'Preview',
        closeAttachment: 'Close attachment preview',
        attachmentFallback: 'Attachment',
        linkUrlTitle: 'Add a link',
        linkUrlLabel: 'Web address',
        linkUrlPlaceholder: 'https://example.com',
        linkTextTitle: 'Name the link',
        linkTextLabel: 'Link text',
        linkTextDefault: 'link',
        loadingEditor: 'Loading note editor…'
    },
    programs: {
        eyebrow: 'AUTOMATIC PROGRAMS', title: 'Programs', description: 'Anote runs enabled programs even when this browser is closed.', add: 'Add program', manualEyebrow: 'MANUAL RUN', manualTitle: 'Run a program now', program: 'Program', sourceDate: 'Source date', targetDate: 'Target date', useOffset: 'Use the program offset', run: 'Run program', running: 'Running…', scheduleEyebrow: 'SCHEDULE', definitionsTitle: 'Program definitions', name: 'Name', activationTime: 'Activation time', targetOffset: 'Target offset', timeZone: 'Time zone', actions: 'Actions', defaultName: 'Move unfinished events', invalidTime: 'Enter a valid 24-hour time from 00:00 through 23:59.', saved: 'Programs saved.', deleted: 'Program deleted.', deleteConfirm: 'Delete this program?', runStarted: 'Running {name}…', runCompleted: '{name} moved {count} unfinished events.', runFailed: '{name} could not run. Try again.', nextRun: 'Next run: {date}', noPrograms: 'Add a program to automate unfinished event moves.', save: 'Save programs'
    },
    serviceUnavailable: 'Anote is unavailable right now. Check your connection and try again.',
    shareUnavailable: 'Events could not be shared. Check your connection and try again.',
    addEventUnavailable: 'The event could not be added. Check your connection and try again.',
    updateEventUnavailable: 'The event could not be updated. Check your connection and try again.',
    completionUnavailable: 'The event status could not be updated. Check your connection and try again.',
    errors: {
        REQUEST_FAILED: 'That action could not be completed. Try again.', INVALID_RESPONSE: 'Anote received an unexpected service response. Try again; if it continues, open diagnostics.', SERVICE_UNAVAILABLE: 'Anote is unavailable right now. Check your connection and try again.', ORIGIN_NOT_ALLOWED: 'This address is not forwarding Anote securely. Open Anote from its direct address or review the Tailscale Serve address and try again.', SESSION_REQUIRED: 'Your session ended. Sign in again to continue.', INVALID_CREDENTIALS: 'The username or password is incorrect.', REGISTRATION_DISABLED: 'New account creation is currently closed.', IMMUTABLE_CONFIG_KEY: 'Account creation is always available and cannot be turned off.', RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.', VALIDATION_FAILED: 'Review the information and try again.', REVISION_CONFLICT: 'This item changed elsewhere. Refresh it before saving again.', FORBIDDEN: 'You do not have access to that item.', NOT_FOUND: 'That item is no longer available.', ATTACHMENT_TYPE_NOT_ALLOWED: 'Choose a supported image or document type.', ATTACHMENT_TOO_LARGE: 'Choose a smaller file and try again.'
    },
    eventStatus: { saving: 'Saving…', completed: 'Completed', done: 'Done', failed: 'Failed', unmark: 'Unmark', markComplete: 'Mark complete', markFailed: 'Mark failed' }
};

type WidenStrings<T> = { [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]> };
export type AppText = WidenStrings<typeof english>;

const spanish: AppText = {
    common: {
        anote: 'Anote', actions: 'Acciones', add: 'Agregar', administration: 'Administración', all: 'Todos', back: 'Volver', backToCalendar: 'Volver al calendario', cancel: 'Cancelar', close: 'Cerrar', color: 'Color', confirm: 'Confirmar', copy: 'Copiar', create: 'Crear', date: 'Fecha', delete: 'Eliminar', deleting: 'Eliminando…', deselect: 'Deseleccionar', disabled: 'Inactivo', edit: 'Editar', enabled: 'Activo', event: 'Evento', events: 'Eventos', hour: 'Hora', language: 'Idioma', link: 'Enlace', loading: 'Cargando…', move: 'Mover', next: 'Siguiente', none: 'Ninguno', noEvents: 'Aún no hay eventos.', note: 'Nota', order: 'Orden', previous: 'Anterior', priority: 'Prioridad', readOnly: 'Solo lectura', remove: 'Quitar', reset: 'Restablecer', role: 'Rol', save: 'Guardar', saveChanges: 'Guardar cambios', saving: 'Guardando…', select: 'Seleccionar', selectAll: 'Seleccionar todo', selected: 'Seleccionados', spanish: 'Español', english: 'Inglés', time: 'Hora', title: 'Título', update: 'Actualizar', user: 'Usuario', users: 'Usuarios', view: 'Ver'
    },
    auth: {
        subtitle: 'Tus planes y notas, en un solo lugar', username: 'Usuario', usernamePlaceholder: 'Escribe tu usuario', password: 'Contraseña', passwordHint: 'Usa al menos 12 caracteres.', signIn: 'Iniciar sesión', signingIn: 'Iniciando sesión…', register: 'Crear cuenta', registering: 'Creando cuenta…', createAccountPrompt: '¿Necesitas una cuenta? Créala', signInPrompt: '¿Ya tienes una cuenta? Inicia sesión'
    },
    shell: {
        openUserMenu: 'Abrir menú de usuario', profile: 'Perfil', friends: 'Amistades', roles: 'Roles', programs: 'Programas', administration: 'Administración', myCalendar: 'Mi calendario', postponedEvents: 'Eventos pospuestos', signOut: 'Cerrar sesión', friendFallback: 'Amistad', backToFriends: 'Volver a amistades', backToCalendar: 'Volver a mi calendario', viewingFriend: 'Estás viendo el calendario de {name}. Aquí no puedes hacer cambios.', viewingOwn: 'Viendo mi calendario', calendarSystem: 'CALENDARIO ANOTE', calendarTitle: 'PLANEA Y ANOTA', defaultSubtitle: 'Marca avances, mueve planes y conserva tus notas de calendario en un solo lugar.', defaultConsoleTitle: 'Consola Anote'
    },
    admin: {
        eyebrow: 'AJUSTES DEL SISTEMA', title: 'Administración', configuration: 'Configuración', configurationDescription: 'Administra el nombre de Anote y la introducción del calendario.', applicationTitle: 'Título de la aplicación', consoleTitle: 'Etiqueta del calendario', subtitle: 'Subtítulo', live: 'EN VIVO', livePreview: 'Vista previa', subtitlePreview: 'Descripción del subtítulo…', eventManagement: 'Administración de eventos', eventManagementDescription: 'Revisa y elimina eventos del calendario.', userManagement: 'Administración de usuarios', userManagementDescription: 'Revisa y elimina usuarios registrados.', roleRecords: 'Registros de roles', roleRecordsDescription: 'Revisa las etiquetas y el orden de los roles. El contenido privado de notas permanece visible solo para su propietario.', rolesTable: 'Roles', records: 'registros', noTableData: 'No hay registros en {table}.', allUsers: 'Todos los usuarios', administrator: 'Administrador', standardUser: 'Usuario', eventCount: '{count} eventos', noAdminEvents: 'No se encontraron eventos.', noAdminUsers: 'No se encontraron usuarios.', editUnavailable: 'La edición de eventos aún no está disponible en esta vista.', applicationTitleRequired: 'Escribe un título para la aplicación.', configurationSaved: 'Configuración guardada.', configurationSaveFailed: 'No se pudo guardar la configuración.', configurationReset: 'Se restablecieron los cambios de configuración sin guardar.', bulkDeleteTitle: '¿Eliminar {items} seleccionados?', bulkDeleteDescription: 'Se eliminarán permanentemente {count} {items}. Esta acción no se puede deshacer.', bulkDeleteSuccess: 'Se eliminaron {count} {items}.', bulkDeleteFailed: 'No se pudieron eliminar los {items} seleccionados.', deleteEventTitle: '¿Eliminar evento?', deleteEventDescription: '“{name}” se eliminará permanentemente.', deleteUserTitle: '¿Eliminar usuario?', deleteUserDescription: 'La cuenta de {name} y sus datos se eliminarán permanentemente.', deleteSelection: 'Eliminar selección', eventsLower: 'eventos', usersLower: 'usuarios', selectAllEvents: 'Seleccionar todos los eventos', selectAllUsers: 'Seleccionar todos los usuarios', selectEvent: 'Seleccionar evento {name}', selectUser: 'Seleccionar usuario {name}', deleteEvent: 'Eliminar evento {name}', deleteUser: 'Eliminar usuario {name}'
    },
    calendar: {
        system: 'CALENDARIO ANOTE', monthView: 'Calendario', monthCoordinates: 'Controles del mes', compare: 'Comparar', matches: 'Coincidencias', postponedEvents: 'Eventos pospuestos', readEvents: 'Leer eventos', inputEvents: 'Agregar eventos', shareEvents: 'Compartir eventos', sharing: 'Compartiendo…', eventsFor: 'Eventos del {date}', shareEventsFor: 'Compartir eventos del {date}', openEventLink: 'Abrir enlace de {name}', moveEvents: 'Mover eventos', selectDays: 'Seleccionar días', markDays: 'Marcar días ({count})', publishEvents: 'Publicar eventos', publishing: 'Publicando…', moving: 'Moviendo…', moveFromDay: 'Mover desde {count} día', moveFromDays: 'Mover desde {count} días', selectedDay: '{count} día seleccionado', selectedDays: '{count} días seleccionados', queuedEvent: '{count} evento en espera', queuedEvents: '{count} eventos en espera', selectedFriend: '{count} amistad seleccionada', selectedFriends: '{count} amistades seleccionadas', target: 'Destino', cancelOperation: 'Cancelar la operación actual', moveIncompleteTo: 'Mover eventos sin terminar al {date}', awaitingSelection: 'Selecciona días en el calendario para continuar.', sector: 'DÍA', marked: 'SELECCIONADO', ghostDay: 'Este día pertenece a otro mes.', selectedDayLabel: 'Día seleccionado', dayAdministration: 'Administración del día', daySettings: 'Ajustes del día', dayContextLabel: 'Etiqueta del día', dayContextPlaceholder: 'Por ejemplo, planeación del sprint', dayContextHelp: 'Agrega una etiqueta corta para reconocer este día fácilmente.', backgroundImage: 'Imagen de fondo', backgroundUrlPlaceholder: 'https://imagenes.ejemplo.com/fondo.jpg', backgroundPreviewOpacity: 'Opacidad de vista previa', noBackground: 'Sin imagen de fondo', saveDaySettings: 'Guardar ajustes del día', eventsAdministration: 'Administración de eventos', eventsAdministrationDescription: 'Organiza los eventos del {date}.', selectCalendarDay: 'Selecciona un día del calendario', openDayHelp: 'Abre un día del calendario para administrar sus eventos.', backToDay: 'Volver al día', noEventsForDay: 'No hay eventos programados para este día.', eventInformation: 'Información de eventos', trackRecord: 'Historial', previouslyPostponed: 'Pospuesto anteriormente', originalEntry: 'Fecha original: {date}', openDayAdministration: 'Abrir administración de eventos del {date}', configureDay: 'Configurar {date}', closeDay: 'Cerrar detalles del día', eventBoard: 'Eventos', createEvent: 'Crear evento', updateEvent: 'Actualizar evento', eventTitlePlaceholder: '¿Qué quieres recordar?', priorityPlaceholder: 'Prioridad', linkPlaceholder: 'Enlace opcional', notePlaceholder: 'Nota opcional', editEvent: 'Editar evento {name}', deleteEvent: 'Eliminar evento {name}', eventAdministration: 'Administración de eventos', groupInput: 'Agregar eventos a los días seleccionados', addEvent: 'Agregar evento', removeQueuedEvent: 'Quitar evento en espera {name}', eventDistribution: 'Distribución de eventos', selectedDayCount: '{current} de {total} días', selectedEventCount: '{current} de {total} eventos', selectedFriendCount: '{current} de {total} amistades', noSelectedDays: 'Selecciona al menos un día para continuar.', selectFriends: 'Seleccionar amistades', noFriends: 'No hay amistades disponibles.', selectEvents: 'Seleccionar eventos', unselectAll: 'Limpiar selección', selectIncomplete: 'Seleccionar sin terminar', noShareableEvents: 'No hay eventos disponibles para compartir.', postponedVault: 'Eventos que esperan una nueva fecha', postponedEventBoard: 'Eventos pospuestos', todayView: 'Hoy', weekView: 'Semana', allView: 'Todos', eventsManagement: 'Administración de eventos', window: 'Rango', action: 'Acción', postponedView: 'Lista de pospuestos', moveToPostponed: 'Mover a pospuestos', copyToPostponed: 'Copiar a pospuestos', source: 'Origen', destination: 'Destino', chooseTarget: 'Elige una fecha de destino.', copySelected: 'Copiar seleccionados', moveSelected: 'Mover seleccionados', postponeSelected: 'Posponer seleccionados', selectedEvent: '{count} evento seleccionado', selectedEvents: '{count} eventos seleccionados'
    },
    social: {
        eyebrow: 'PERSONAS', title: 'Amistades', description: 'Consulta a todos los usuarios de Anote y administra tu lista de amistades. Sus calendarios son de solo lectura.', backToOwnCalendar: 'Volver a {name}', friends: 'Amistades', noFriends: 'Aún no tienes amistades. Agrega a alguien del directorio.', viewCalendar: 'Ver el calendario de {name}', removeFriend: 'Quitar a {name} de amistades', directory: 'Todos los usuarios', friend: 'Amistad', addFriend: 'Agregar a {name} como amistad', noOtherUsers: 'No se encontraron otros usuarios.'
    },
    profile: {
        eyebrow: 'PERFIL', title: 'Apariencia', description: 'Personaliza tu calendario. Estas opciones solo afectan tu vista; los calendarios de amistades siguen siendo de solo lectura.', username: 'Usuario', backgroundImageUrl: 'URL de la imagen de fondo', backgroundHelp: 'Déjalo vacío para usar el degradado predeterminado.', accent: 'Color de acento', accentText: 'Valor del color de acento', noiseOverlay: 'Agregar textura', theme: 'Tema', light: 'Claro', dark: 'Oscuro', themeHelp: 'Elige una interfaz clara o cómoda para la noche. La opción se guarda en tu perfil.', reset: 'Restablecer apariencia', save: 'Guardar preferencias'
    },
    roles: {
        eyebrow: 'ETIQUETAS DEL CALENDARIO', title: 'Roles', description: 'Define los roles usados en notas de eventos y mantén su orden en todo tu calendario.', roles: 'Roles', rolesHelp: 'Usa etiquetas concisas para que las personas colaboradoras elijan rápidamente.', addRole: 'Agregar rol', noRoles: 'No se han definido roles.', moveRoleUp: 'Subir {name}', moveRoleDown: 'Bajar {name}', renameRole: 'Renombrar rol {name}', renameRoleTitle: 'Renombrar rol', roleName: 'Nombre del rol', roleNameExample: 'Por ejemplo, Revisor', createRoleTitle: 'Crear rol', addSubrole: 'Agregar un subrol a {name}', createSubroleTitle: 'Crear subrol para {name}', subroleName: 'Nombre del subrol', renameSubrole: 'Renombrar subrol {name}', renameSubroleTitle: 'Renombrar subrol', deleteRole: 'Eliminar rol {name}', deleteRoleTitle: '¿Eliminar rol?', deleteRoleDescription: '“{name}” y sus subroles se eliminarán permanentemente.', deleteSubrole: 'Eliminar subrol {name}', deleteSubroleTitle: '¿Eliminar subrol?', deleteSubroleDescription: '“{name}” se eliminará permanentemente.', selectRole: 'Seleccionar rol', noRolesAvailable: 'No hay roles disponibles.', subrolesFor: 'Subroles de {name}', noSubrolesAvailable: 'No hay subroles disponibles.'
    },
    notes: {
        closeEditor: 'Cerrar editor de notas', savedAt: 'Guardado a las {time}', writeAs: 'Escribe tus observaciones como {role}…', noPreview: 'No hay contenido de la nota para previsualizar.', attachments: 'Archivos adjuntos', uploading: 'Subiendo…', dropFiles: 'Arrastra archivos aquí', clickToUpload: 'o elige archivos', markdownSupported: 'Se admite formato Markdown', editMode: 'Editar nota', previewMode: 'Previsualizar nota', attachFile: 'Adjuntar archivos', insertLink: 'Insertar enlace', saveNote: 'Guardar nota', loadingText: 'Cargando vista previa de texto…', textPreviewFailed: 'No se pudo cargar la vista previa de este texto.', noInlinePreview: 'Este tipo de archivo no se puede previsualizar aquí.', uploadedFile: 'Archivo subido', preview: 'Vista previa', closeAttachment: 'Cerrar vista previa del archivo', attachmentFallback: 'Archivo adjunto', linkUrlTitle: 'Agregar un enlace', linkUrlLabel: 'Dirección web', linkUrlPlaceholder: 'https://ejemplo.com', linkTextTitle: 'Nombra el enlace', linkTextLabel: 'Texto del enlace', linkTextDefault: 'enlace', loadingEditor: 'Cargando editor de notas…'
    },
    programs: {
        eyebrow: 'PROGRAMAS AUTOMÁTICOS', title: 'Programas', description: 'Anote ejecuta los programas activos aunque este navegador esté cerrado.', add: 'Agregar programa', manualEyebrow: 'EJECUCIÓN MANUAL', manualTitle: 'Ejecutar un programa ahora', program: 'Programa', sourceDate: 'Fecha de origen', targetDate: 'Fecha de destino', useOffset: 'Usar el desplazamiento del programa', run: 'Ejecutar programa', running: 'Ejecutando…', scheduleEyebrow: 'HORARIO', definitionsTitle: 'Definiciones de programas', name: 'Nombre', activationTime: 'Hora de activación', targetOffset: 'Días de desplazamiento', timeZone: 'Zona horaria', actions: 'Acciones', defaultName: 'Mover eventos sin terminar', invalidTime: 'Escribe una hora válida de 24 horas entre 00:00 y 23:59.', saved: 'Programas guardados.', deleted: 'Programa eliminado.', deleteConfirm: '¿Eliminar este programa?', runStarted: 'Ejecutando {name}…', runCompleted: '{name} movió {count} eventos sin terminar.', runFailed: 'No se pudo ejecutar {name}. Inténtalo de nuevo.', nextRun: 'Próxima ejecución: {date}', noPrograms: 'Agrega un programa para automatizar el movimiento de eventos sin terminar.', save: 'Guardar programas'
    },
    serviceUnavailable: 'Anote no está disponible en este momento. Revisa tu conexión e inténtalo de nuevo.',
    shareUnavailable: 'No se pudieron compartir los eventos. Revisa tu conexión e inténtalo de nuevo.',
    addEventUnavailable: 'No se pudo agregar el evento. Revisa tu conexión e inténtalo de nuevo.',
    updateEventUnavailable: 'No se pudo actualizar el evento. Revisa tu conexión e inténtalo de nuevo.',
    completionUnavailable: 'No se pudo actualizar el estado del evento. Revisa tu conexión e inténtalo de nuevo.',
    errors: {
        REQUEST_FAILED: 'No se pudo completar la acción. Inténtalo de nuevo.', INVALID_RESPONSE: 'Anote recibió una respuesta inesperada del servicio. Inténtalo de nuevo; si continúa, abre los diagnósticos.', SERVICE_UNAVAILABLE: 'Anote no está disponible en este momento. Revisa tu conexión e inténtalo de nuevo.', ORIGIN_NOT_ALLOWED: 'Esta dirección no está reenviando Anote de forma segura. Abre Anote desde su dirección directa o revisa la dirección de Tailscale Serve e inténtalo de nuevo.', SESSION_REQUIRED: 'Tu sesión terminó. Inicia sesión de nuevo para continuar.', INVALID_CREDENTIALS: 'El usuario o la contraseña son incorrectos.', REGISTRATION_DISABLED: 'El registro de cuentas nuevas está cerrado por el momento.', IMMUTABLE_CONFIG_KEY: 'La creación de cuentas siempre está disponible y no se puede desactivar.', RATE_LIMITED: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', VALIDATION_FAILED: 'Revisa la información e inténtalo de nuevo.', REVISION_CONFLICT: 'Este elemento cambió en otro lugar. Actualízalo antes de guardar de nuevo.', FORBIDDEN: 'No tienes acceso a ese elemento.', NOT_FOUND: 'Ese elemento ya no está disponible.', ATTACHMENT_TYPE_NOT_ALLOWED: 'Elige un tipo de imagen o documento compatible.', ATTACHMENT_TOO_LARGE: 'Elige un archivo más pequeño e inténtalo de nuevo.'
    },
    eventStatus: { saving: 'Guardando…', completed: 'Completado', done: 'Hecho', failed: 'Fallido', unmark: 'Quitar marca', markComplete: 'Marcar como completado', markFailed: 'Marcar como fallido' }
};

const messages: Record<AnoteLanguage, AppText> = { en: english, es: spanish };

export const LANGUAGE_STORAGE_KEY = 'anote-language';

export const resolveAnoteLanguage = (language?: string): AnoteLanguage => {
    const runtimeLanguage = language ?? (typeof navigator === 'undefined' ? 'en' : navigator.language);
    return runtimeLanguage.toLowerCase().startsWith('es') ? 'es' : 'en';
};

const readStoredLanguage = (): AnoteLanguage => {
    try {
        return resolveAnoteLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) || undefined);
    } catch {
        return resolveAnoteLanguage();
    }
};

let currentLanguage = readStoredLanguage();

export const setRuntimeLanguage = (language: AnoteLanguage) => {
    currentLanguage = language;
    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
        // Runtime language still changes when browser storage is unavailable.
    }
};

export const getAppText = (language?: string) => messages[
    language === undefined ? currentLanguage : resolveAnoteLanguage(language)
];

export const interpolateText = (value: string, replacements: Record<string, string | number>) =>
    Object.entries(replacements).reduce(
        (result, [key, replacement]) => result.replaceAll(`{${key}}`, String(replacement)),
        value
    );

export const getApiErrorText = (code: string, language?: string) => {
    const text = getAppText(language);
    return text.errors[code.toUpperCase() as keyof typeof text.errors] || text.errors.REQUEST_FAILED;
};
