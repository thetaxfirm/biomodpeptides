// Existing report/CSV tests isolate their report state from the independently tested shared controls.
module.exports = function periodFixture(getHooks) {
  return {
    useReportPeriod(initial = '7') {
      const [period, setPeriod] = getHooks().useState(initial);
      return { query: 'timeZone=UTC&days=' + period, selection: { period, timeZone: 'UTC' }, draft: { period, timeZone: 'UTC' }, choose: setPeriod };
    },
    ReportPeriodControls({ control }) { return require('react').createElement('select', { value: control.selection.period, onChange: event => control.choose(event.target.value) }); },
  };
};
