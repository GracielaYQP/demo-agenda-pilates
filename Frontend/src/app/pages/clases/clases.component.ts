import { Component } from '@angular/core';
import { Router } from '@angular/router';


@Component({
  selector: 'app-clases',
  standalone: true,
  imports: [],
  templateUrl: './clases.component.html',
  styleUrl: './clases.component.css'
})
export class ClasesComponent {
  constructor(private router: Router) {}
  
      volverAlInicio() {
      this.router.navigate(['/']);
    }

}
