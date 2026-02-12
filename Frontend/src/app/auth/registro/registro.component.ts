import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NgClass, NgIf } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { InvitacionService } from '../../services/invitacion.services';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgClass],
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css'],
})
export class RegistroComponent implements OnInit, OnDestroy {
  form!: FormGroup;

  // estado UI
  error = '';
  successMessage = '';
  showPassword = false;

  // flujo invitación/admin
  isAdmin = false;            // ✅ ÚNICO flag de admin
  esInvitacion = false;
  invitacionValida = false;
  telefono = '';
  nivel = '';

  private tokenInvitacion: string | null = null; 

  // modal “no invitación”
  mostrarNoInvitacion = false;
  private _noInvTimer: any;

  // modal genérico (si lo usás en otro lado)
  mostrarModal = false;
  private _modalTimer: any;

  isAdminInvite = false;

  @HostListener('document:keydown.escape')
  onEsc() { if (this.mostrarNoInvitacion) this.cerrarNoInvitacion(); }

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private invitacionService: InvitacionService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  // ------------------ Ciclo de vida ------------------
  ngOnInit() {
    // 1) Determinar admin por rol
    const rol = (localStorage.getItem('rol') || '').toLowerCase();
    this.isAdmin = (rol === 'admin' || rol === 'superadmin');


    // 2) Detectar si vino con token de invitación
    const token = this.route.snapshot.queryParamMap.get('token');
    this.esInvitacion = !!token;
    this.tokenInvitacion = token;

    // 3) Crear formulario (nivel/teléfono deshabilitados por default)
    this.crearFormulario();

    // 4) Si admin ⇒ habilitar nivel/teléfono y no mostrar modal “no invitación”
    //    Si invitación ⇒ validar token y completar nivel/teléfono (siguen deshabilitados)
    //    Si visitante sin token ⇒ mostrar modal de no invitación
    if (this.isAdmin) {
      this.invitacionValida = true; // fuerza flujo OK para admin
      this.form.get('nivel')!.enable({ emitEvent: false });
      this.form.get('telefono')!.enable({ emitEvent: false });
    } else if (this.esInvitacion && token) {
      this.validarInvitacion(token);
    } else {
      this.invitacionValida = false;
      this.abrirModalInvalidoConAutoCierre();
    }
  }

  ngOnDestroy() {
    if (this._noInvTimer) clearTimeout(this._noInvTimer);
    if (this._modalTimer) clearTimeout(this._modalTimer);
  }

  // ------------------ Invitación ------------------
  private validarInvitacion(token: string) {
    this.invitacionService.getInvitacion(token).subscribe({
      next: (res) => {
        this.invitacionValida = true;
        this.telefono = res.telefono;
        this.nivel = res.nivel ?? '';

        // si la invitación era admin, no muestres nivel/plan como alumno
        this.isAdminInvite = (res.rol === 'admin');

        // Esto muestra los valores en los inputs deshabilitados
        this.form.patchValue({
          telefono: res.telefono,
          nivel: res.nivel ?? 'Básico',
        });

        // si es admin invitado: planMensual fijo 0 y ocultás el select
        if (this.isAdminInvite) {
          this.nivel = ''; // no aplica
          this.form.patchValue({ nivel: 'Básico', planMensual: '0' });
          this.form.get('planMensual')?.disable({ emitEvent: false });
        }
      },
      error: () => {
        this.invitacionValida = false;
        this.error = 'Invitación inválida o expirada.';
        if (!this.isAdmin) this.abrirModalInvalidoConAutoCierre();
      },
    });
  }
  
  // ------------------ Formulario ------------------
  private crearFormulario() {
    this.form = this.fb.group({
      dni: ['', [Validators.required, Validators.pattern(/^[\d]{7,8}$/)]],
      nombre: ['', [Validators.required, Validators.pattern(/^([a-zA-ZáéíóúüÁÉÍÓÚÜñÑ\s]{3,})$/)]],
      apellido: ['', [Validators.required, Validators.pattern(/^([a-zA-ZáéíóúüÁÉÍÓÚÜñÑ\s]{3,})$/)]],
      planMensual: ['0', Validators.required],       // 0 = suelta/prueba
      nivel: [{ value: '', disabled: true }],         // habilito luego si admin
      telefono: [{ value: '', disabled: true }],      // habilito luego si admin
      email: ['', [Validators.required, Validators.email]],
      password: ['', [
        Validators.required,
        Validators.pattern(/^(?=(?:.*\d))(?=.*[A-Z])(?=.*[a-z])(?=.*[.,*!?¿¡/#$%&])\S{8,20}$/),
      ]],
    });
  }

  // ------------------ Modal "no invitación" ------------------
  private abrirModalInvalidoConAutoCierre(ms = 6000) {
    this.mostrarNoInvitacion = true;
    if (this._noInvTimer) clearTimeout(this._noInvTimer);
    this._noInvTimer = setTimeout(() => this.cerrarNoInvitacion(), ms);
  }
  onOverlayNoInvClick() { this.cerrarNoInvitacion(); }
  stopCloseNoInv(e: MouseEvent) { e.stopPropagation(); }
  cerrarNoInvitacion(): void {
    this.mostrarNoInvitacion = false;
    if (this._noInvTimer) clearTimeout(this._noInvTimer);
    this.router.navigate(['/']);
  }

  // ------------------ Envío ------------------

  submit() {
    if (this.form.invalid) return;

    this.error = '';
    this.successMessage = '';

    const raw = this.form.getRawValue();
    const planMensual = String(raw.planMensual ?? '0');

    // ✅ CASO 1: Registro por invitación (AUTLOGIN)
    if (this.esInvitacion && this.invitacionValida && this.tokenInvitacion) {
      const payloadInvitacion = {
        dni: raw.dni,
        nombre: raw.nombre,
        apellido: raw.apellido,
        email: raw.email,
        password: raw.password,
        planMensual,                     // si es admin invitado en tu UI: queda en '0'
        telefono: this.telefono,         // viene de la invitación
        token: this.tokenInvitacion,     // obligatorio
      };

      this.auth.registerInvitacion(payloadInvitacion).subscribe({
        next: (res: any) => {
          this.successMessage = '¡Registro exitoso! Iniciando sesión...';
          this.error = '';

          // guardar token si vino (tu backend devuelve autologin)
          const token = res?.access_token ?? res?.token;
          if (token) {
            localStorage.setItem('token', token);
            localStorage.setItem('nombreUsuario', res.nombre ?? '');
            localStorage.setItem('apellidoUsuario', res.apellido ?? '');
            localStorage.setItem('rol', res.rol ?? '');
            if (res.nivel) localStorage.setItem('nivelUsuario', res.nivel);
            if (res.planMensual) localStorage.setItem('planMensual', String(res.planMensual));
          }

          const rol = String(res?.rol ?? '').toLowerCase();

          setTimeout(() => {
            if (rol === 'admin' || rol === 'superadmin') {
              this.router.navigate(['/gestion-turnos']);
            } else {
              this.router.navigate(['/horarios-disponibles']);
            }
          }, 600);
        },
        error: (err) => {
          const msg = err?.error?.message ?? 'Error al registrar (invitación)';
          this.error = Array.isArray(msg) ? msg.join(' • ') : msg;
          this.successMessage = '';
        },
      });

      return;
    }

    // ✅ CASO 2: Registro manual (admin) -> /users (SIN autologin)
    const payload = {
      dni: raw.dni,
      nombre: raw.nombre,
      apellido: raw.apellido,
      email: raw.email,
      password: raw.password,
      planMensual,
      telefono: raw.telefono,
      nivel: raw.nivel,
    };

    this.auth.register(payload).subscribe({
      next: () => {
        this.successMessage = '¡Registro exitoso!';
        this.error = '';
        setTimeout(() => this.router.navigate(['/login']), 1200);
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Error al registrar';
        this.error = Array.isArray(msg) ? msg.join(' • ') : msg;
        this.successMessage = '';
      },
    });
  }

  // ------------------ Helpers UI ------------------
  get Dni() { return this.form.get('dni'); }
  get Nombre() { return this.form.get('nombre'); }
  get Apellido() { return this.form.get('apellido'); }
  get Telefono() { return this.form.get('telefono'); }
  get Password() { return this.form.get('password'); }

  togglePasswordVisibility() { this.showPassword = !this.showPassword; }

  onOverlayClick() { this.cerrarModal(); }
  stopClose(e: MouseEvent) { e.stopPropagation(); }
  cerrarModal(): void {
    this.mostrarModal = false;
    if (this._modalTimer) clearTimeout(this._modalTimer);
    this.router.navigate(['/']);
  }

  cerrarFormulario() {
    this.invitacionValida = false;
    this.router.navigate(['/listar-alumnos']);
  }
}
