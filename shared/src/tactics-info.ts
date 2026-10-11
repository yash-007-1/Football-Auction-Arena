import type { Tactics } from './types';

/** Short explanations shown in the tactics screen. They describe what the simulation actually does. */
export const TACTIC_OPTIONS: { key: keyof Pick<Tactics, 'mentality' | 'buildUp' | 'pressing' | 'defensiveLine' | 'width' | 'passingRisk'>; label: string; options: { value: string; label: string; help: string }[] }[] = [
  { key: 'mentality', label: 'Mentality', options: [
    { value: 'very_defensive', label: 'Very Defensive', help: 'Sits back: fewer chances created (−5 attack), but a much stronger back line (+4 defence) and less of the ball.' },
    { value: 'defensive', label: 'Defensive', help: 'Slightly lower attacking output (−2.5) for a sturdier defence (+2).' },
    { value: 'balanced', label: 'Balanced', help: 'No bonus or penalty either way.' },
    { value: 'attacking', label: 'Attacking', help: 'More attacking threat (+2.5) and tempo, but the defence is more exposed (−2).' },
    { value: 'very_attacking', label: 'Very Attacking', help: 'All-out attack (+5 attack, faster tempo) with a big defensive cost (−4 defence).' },
  ] },
  { key: 'buildUp', label: 'Build-up play', options: [
    { value: 'short', label: 'Short Passing', help: 'More possession (better with high-passing midfielders) and higher pass accuracy, but slower tempo.' },
    { value: 'balanced', label: 'Balanced', help: 'Mix of short and long.' },
    { value: 'direct', label: 'Direct', help: 'Faster attacks, helped by physical forwards and effective against a high press, but less possession and accuracy.' },
  ] },
  { key: 'pressing', label: 'Pressing', options: [
    { value: 'low', label: 'Low', help: 'Saves stamina and fouls less, but gives up some possession.' },
    { value: 'medium', label: 'Medium', help: 'Standard intensity.' },
    { value: 'high', label: 'High', help: 'Wins the ball back (more possession, opponent chances down) but tires players faster, fouls and gets booked more, and leaves space behind.' },
  ] },
  { key: 'defensiveLine', label: 'Defensive line', options: [
    { value: 'deep', label: 'Deep', help: 'Harder to break down (+1.4 defence) but cedes possession.' },
    { value: 'balanced', label: 'Balanced', help: 'Standard shape.' },
    { value: 'high', label: 'High', help: 'Compact midfield and more possession, but pacey opposing forwards exploit the space behind.' },
  ] },
  { key: 'width', label: 'Width', options: [
    { value: 'narrow', label: 'Narrow', help: 'Central overload, more possession; beats wide defences, struggles against narrow ones.' },
    { value: 'balanced', label: 'Balanced', help: 'No matchup effect.' },
    { value: 'wide', label: 'Wide', help: 'Stretches narrow defences; less effective against opponents who also defend wide.' },
  ] },
  { key: 'passingRisk', label: 'Passing risk', options: [
    { value: 'safe', label: 'Safe', help: 'Higher pass accuracy, slower tempo, slightly fewer chances.' },
    { value: 'balanced', label: 'Balanced', help: 'Standard.' },
    { value: 'risky', label: 'Risky', help: 'More chances and tempo, lower pass accuracy.' },
  ] },
];

export const COUNTER_HELP = 'When you have less of the ball, quick breaks create better chances (more with pacey forwards), at the cost of some possession.';
export const SETPIECE_HELP = 'The set-piece taker takes any penalties. The captain is shown on the team sheet.';
