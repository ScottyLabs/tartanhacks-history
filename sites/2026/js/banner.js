// Banner close functionality
document.addEventListener('DOMContentLoaded', function() {
    const banner = document.getElementById('thank-you-banner');
    const closeBtn = document.getElementById('banner-close-btn');
    
    if (closeBtn && banner) {
        closeBtn.addEventListener('click', function() {
            banner.style.display = 'none';
        });
    }
});
