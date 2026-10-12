import { createTheme } from '@mantine/core';

// Lovable-inspired theme with BU Blue primary color
export const theme = createTheme({
  primaryColor: 'buBlue',
  defaultRadius: 'md',
  colors: {
    // BU Blue - Primary color (HSL: 211 100% 40%)
    buBlue: [
      '#e6f0ff', // Lightest
      '#cce0ff',
      '#99c2ff',
      '#66a3ff',
      '#3385ff',
      '#0066ff', // Base - rgb(0, 102, 255)
      '#0052cc',
      '#003d99',
      '#002966',
      '#001433', // Darkest
    ],
    // Warm Red/Orange - Secondary (HSL: 0 65% 51%)
    warmRed: [
      '#ffe6e6',
      '#ffcccc',
      '#ff9999',
      '#ff6666',
      '#ff3333',
      '#cc1a1a', // Base - approximately rgb(204, 26, 26)
      '#991414',
      '#660d0d',
      '#330707',
      '#1a0303',
    ],
    // Success Green - Accent (HSL: 142 71% 45%)
    successGreen: [
      '#e6f7ed',
      '#ccefdb',
      '#99dfb7',
      '#66cf93',
      '#33bf6f',
      '#14a854', // Base - approximately rgb(20, 168, 84)
      '#108643',
      '#0c6432',
      '#084221',
      '#042111',
    ],
    // Warning Yellow (for hand raises)
    warning: [
      '#fff9e6',
      '#fff3cc',
      '#ffe799',
      '#ffdb66',
      '#ffcf33',
      '#FFC20A', // Base - exact from Lovable
      '#cc9b08',
      '#997406',
      '#664d04',
      '#332602',
    ],
  },
  components: {
    Button: {
      defaultProps: {
        color: 'buBlue',
        variant: 'filled',
      },
    },
    Card: {
      defaultProps: {
        shadow: 'sm',
        padding: 'lg',
        radius: 'md',
        withBorder: true,
      },
    },
    Paper: {
      defaultProps: {
        shadow: 'xs',
        padding: 'md',
        radius: 'md',
      },
    },
  },
  other: {
    // Gradient backgrounds
    gradients: {
      primary: 'linear-gradient(135deg, rgba(0, 102, 255, 0.05) 0%, rgba(255, 255, 255, 0) 50%, rgba(204, 26, 26, 0.05) 100%)',
      card: 'linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.95) 100%)',
    },
  },
});
