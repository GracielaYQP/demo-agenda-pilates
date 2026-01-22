import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/header/header.component';
import { FooterComponent } from './shared/footer/footer.component';
import { AuthService } from './services/auth.service';
import { filter } from 'rxjs';
import { BRAND } from './core/config/brand';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent  implements OnInit {
  title = 'Frontend';
  links = BRAND.links;

  constructor(private auth: AuthService, private router: Router) {
    window.addEventListener('beforeunload', () => {
      this.auth.logout();
    });
  }

  ngOnInit() {
    // 1) Desactivar restauración de scroll del navegador
    if ('scrollRestoration' in history) {
      try { (history as any).scrollRestoration = 'manual'; } catch {}
    }

    // 2) En cada NavigationEnd, forzar scroll al tope
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => {
      this.forceScrollTop();
      // Asegurar después de pintar la vista (componentes/hijos)
      requestAnimationFrame(() => this.forceScrollTop());
      setTimeout(() => this.forceScrollTop(), 0);           // microtask
      setTimeout(() => this.forceScrollTop(), 50);          // por si hay imágenes/cargas
    });
  }

  private forceScrollTop() {
    // Si usás un contenedor scroll (marcalo con data-scroll-container)
    const container = document.querySelector('[data-scroll-container]') as HTMLElement | null;

    // Lista de targets posibles; el primero que exista y tenga scrollTop se usa
    const targets: (HTMLElement | Element | null | undefined)[] = [
      container,
      document.scrollingElement as Element | null,
      document.documentElement,
      document.body
    ];

    for (const t of targets) {
      if (!t) continue;
      // Preferir scrollTo si existe
      if (typeof (t as any).scrollTo === 'function') {
        try { (t as any).scrollTo(0, 0); } catch {}
      }
      // Fallback directo al scrollTop
      try { (t as any).scrollTop = 0; } catch {}
    }

    // Y además el window, por si acaso
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch {}
  }
}

