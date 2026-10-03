import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <div class="mb-6">
        <h1 class="text-3xl font-bold tracking-tight text-white">Portfolio</h1>
        <p class="text-slate-400 mt-1">Manage your holdings and asset allocations.</p>
      </div>

      <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
        <p class="text-lg">Portfolio feature skeleton initialized. Authentication & positions coming in future phases!</p>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Portfolio {}
