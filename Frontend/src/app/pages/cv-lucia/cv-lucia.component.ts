import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-cv-lucia',
  standalone: true,
  imports: [],
  templateUrl: './cv-lucia.component.html',
  styleUrl: './cv-lucia.component.css'
})
export class CvLuciaComponent {
  constructor(private router: Router) {}
  
      volverAlInicio() {
      this.router.navigate(['/']);
    }

}
