import { Routes } from '@angular/router';
import { AuthGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  { path: 'acerca-de', loadComponent: () => import('./pages/acerca-de/acerca-de.component').then(m => m.AcercaDeComponent) },
  { path: 'cv-instructor', loadComponent: () => import('./pages/cv-instructor/cv-instructor.component').then(m => m.CvInstructorComponent) },
  { path: 'login', loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./auth/registro/registro.component').then(m => m.RegistroComponent) },
  { path: 'clases', loadComponent: () => import('./pages/clases/clases.component').then(m => m.ClasesComponent) },
  { path: 'horarios-disponibles', loadComponent: () => import('./horarios-disponibles/horarios-disponibles.component').then(m => m.HorariosDisponiblesComponent) },
  { path: 'dashboard-tabs', loadComponent: () => import('./admin/dashboard-tabs/dashboard-tabs.component').then(m => m.DashboardTabsComponent) },
  { 
    path: 'planes',
    canActivate: [AuthGuard], 
    loadComponent: () => import('./pages/planes/planes.component').then(m => m.PlanesComponent) 
  },
  {
    path: 'gestion-turnos',
    canActivate: [AuthGuard],
    loadComponent: () => import('./gestion-turnos/gestion-turnos.component').then(m => m.GestionTurnosComponent)
  },
  {
    path: 'mis-turnos',
    canActivate: [AuthGuard],
    loadComponent: () => import('./mis-turnos/mis-turnos.component').then(m => m.MisTurnosComponent)
  },
  {
    path: 'admin/invitaciones',
    canActivate: [AuthGuard], data: { roles: ['admin'] },
    loadComponent: () => import('./admin/invitaciones/invitaciones.component').then(m => m.InvitacionesComponent)
  },
  {
    path: 'listar-alumnos',
    canActivate: [AuthGuard], data: { roles: ['admin'] },
    loadComponent: () => import('./admin/listar-alumnos/listar-alumnos.component').then(m => m.ListarAlumnosComponent)
  },

  { path: 'editar-usuario/:id', loadComponent: () => import('./admin/editar-usuario/editar-usuario.component').then(m => m.EditarUsuarioComponent) },
  { path: 'reset-password/:token', loadComponent: () => import('./admin/reset-password/reset-password.component').then(m => m.ResetPasswordComponent) },
  { path: 'clases-suspendidas',  
    canActivate: [AuthGuard], data: { roles: ['admin'] },
    loadComponent: () => import('./admin/clases-suspendidas/clases-suspendidas.component').then(m => m.ClasesSuspendidasComponent) },
  { path: 'valor-planes',  
    canActivate: [AuthGuard], data: { roles: ['admin'] },
    loadComponent: () => import('./admin/valor-planes/valor-planes.component').then(m => m.ValorPlanesComponent) },

  // Páginas legales (también lazy)
  { path: 'terminos-y-condiciones', loadComponent: () => import('./pages/terminos-y-condiciones/terminos-y-condiciones.component').then(m => m.TerminosYCondicionesComponent) },
  { path: 'politica-de-privacidad', loadComponent: () => import('./pages/politica-de-privacidad/politica-de-privacidad.component').then(m => m.PoliticaDePrivacidadComponent) },
  { path: 'politica-de-cookies', loadComponent: () => import('./pages/politica-de-cookies/politica-de-cookies.component').then(m => m.PoliticaDeCookiesComponent) },
  { path: 'normas-basicas', loadComponent: () => import('./pages/normas-basicas/normas-basicas.component').then(m => m.NormasBasicasComponent) },

  { path: '**', redirectTo: '' } 
];

