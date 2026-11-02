import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  sendLoginLink: vi.fn(),
  sendPasswordReset: vi.fn(),
}));
vi.mock('../../backend/supabase', () => api);

import { LoginPage } from './Login';

describe('LoginPage', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
  });

  it('logger inn med e-post og passord som standard', async () => {
    api.signInWithPassword.mockRejectedValue(new Error('Feil e-post eller passord.'));
    render(<LoginPage onDemo={() => {}} />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'meg@eksempel.no' } });
    fireEvent.change(screen.getByLabelText('Passord'), { target: { value: 'hemmelig-setning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logg inn' }));
    await waitFor(() => expect(api.signInWithPassword).toHaveBeenCalledWith('meg@eksempel.no', 'hemmelig-setning'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feil e-post eller passord.');
  });

  it('krever passord før innlogging', () => {
    render(<LoginPage onDemo={() => {}} />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'meg@eksempel.no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logg inn' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Skriv inn passordet ditt.');
    expect(api.signInWithPassword).not.toHaveBeenCalled();
  });

  it('kan fortsatt sende innloggingslenke', async () => {
    api.sendLoginLink.mockResolvedValue(undefined);
    render(<LoginPage onDemo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lenke på e-post' }));
    expect(screen.queryByLabelText('Passord')).toBeNull();
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'meg@eksempel.no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send innloggingslenke' }));
    expect(await screen.findByText('Sjekk e-posten din')).toBeInTheDocument();
    expect(api.sendLoginLink).toHaveBeenCalledWith('meg@eksempel.no');
  });

  it('sender lenke for nytt passord', async () => {
    api.sendPasswordReset.mockResolvedValue(undefined);
    render(<LoginPage onDemo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Glemt passord?' }));
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'meg@eksempel.no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send lenke for nytt passord' }));
    expect(await screen.findByText(/velge nytt passord/)).toBeInTheDocument();
    expect(api.sendPasswordReset).toHaveBeenCalledWith('meg@eksempel.no');
  });
});
