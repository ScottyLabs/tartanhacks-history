/**
 * Cursor Effect - Mouse Tracking
 * Creates a custom cursor effect that follows the mouse on desktop devices
 */

(function () {
    'use strict';

    /**
     * Check if the device is mobile based on user agent
     * @returns {boolean} True if mobile device
     */
    function isMobileDevice() {
        return /iPhone|iPod|iPad|Android|BlackBerry|IEMobile/i.test(navigator.userAgent);
    }

    /**
     * Initialize mouse tracking for custom cursor effect
     */
    function initCursorEffect() {
        // Skip on mobile devices
        if (isMobileDevice()) {
            return;
        }

        document.addEventListener('mousemove', function (e) {
            // Update CSS variables with the current mouse coordinates
            document.documentElement.style.setProperty('--mouse-x', e.clientX + 'px');
            document.documentElement.style.setProperty('--mouse-y', e.clientY + 'px');
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCursorEffect);
    } else {
        initCursorEffect();
    }
})();
