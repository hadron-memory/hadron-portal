import { mount } from 'svelte';
import Harness from './TeamChatChipsHarness.svelte';
export function mountTeamChatChips(target: HTMLElement) { return mount(Harness, { target }); }
